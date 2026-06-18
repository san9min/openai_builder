const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 5173);
const ROOT = __dirname;
const CLIENTS = new Set();

const TOPICS = [
  {
    text: "나와 대화하는 나를 동물로 표현하면?",
    examples: ["거북이", "고양이", "부엉이", "수달"],
  },
  {
    text: "내 대화 스타일을 브랜드로 표현하면?",
    examples: ["무인양품", "애플", "파타고니아", "나이키"],
  },
  {
    text: "우리 대화를 콘텐츠로 표현하면?",
    examples: ["팟캐스트", "다큐멘터리", "비하인드 로그", "인터뷰"],
  },
  {
    text: "나를 회의실 분위기로 표현하면?",
    examples: ["화이트보드 앞", "조용한 창가", "스탠딩 미팅", "긴 테이블 끝"],
  },
  {
    text: "나와 협업하는 느낌을 날씨로 표현하면?",
    examples: ["맑은 가을 오후", "잔잔한 비", "초여름 바람", "안개 뒤 햇살"],
  },
  {
    text: "내가 아이디어를 낼 때의 모습을 음식으로 표현하면?",
    examples: ["비빔밥", "잘 끓인 수프", "타코", "오마카세"],
  },
];

function pickTopic(currentText) {
  const candidates = TOPICS.filter((topic) => topic.text !== currentText);
  return candidates[Math.floor(Math.random() * candidates.length)] || TOPICS[0];
}

function createState(topic = pickTopic()) {
  return {
    topic,
    phase: "setup",
    turnRole: null,
    pending: null,
    turn: 0,
    secrets: {
      human: "",
      codex: "",
    },
    messages: [
      systemMessage("오늘의 주제가 정해졌어요. /human과 /codex에서 각자 비밀 답변을 설정하면 시작합니다."),
    ],
    version: 1,
  };
}

let state = createState();

function systemMessage(text) {
  return createMessage("system", text, "system");
}

function createMessage(role, text, kind = "message") {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    text,
    kind,
    createdAt: new Date().toISOString(),
  };
}

function roleLabel(role) {
  return role === "codex" ? "Codex" : "Human";
}

function otherRole(role) {
  return role === "codex" ? "human" : "codex";
}

function sanitizeRole(value) {
  return value === "codex" ? "codex" : "human";
}

function getPublicState(role = "human") {
  const safeRole = sanitizeRole(role);
  const opponent = otherRole(safeRole);
  const ended = state.phase === "ended";

  return {
    topic: state.topic,
    phase: state.phase,
    role: safeRole,
    opponent,
    turnRole: state.turnRole,
    pending: state.pending,
    turn: state.turn,
    answerStatus: {
      human: Boolean(state.secrets.human),
      codex: Boolean(state.secrets.codex),
    },
    ownSecret: state.secrets[safeRole] || "",
    revealedSecrets: ended
      ? {
          human: state.secrets.human,
          codex: state.secrets.codex,
        }
      : null,
    messages: state.messages,
    version: state.version,
  };
}

function setSecret(role, answer) {
  const trimmed = String(answer || "").trim();
  if (!trimmed) {
    return { ok: false, status: 400, error: "비밀 답변을 입력해주세요." };
  }

  if (state.phase !== "setup") {
    return { ok: false, status: 409, error: "게임이 시작된 뒤에는 비밀 답변을 바꿀 수 없어요." };
  }

  state.secrets[role] = trimmed;
  state.messages.push(systemMessage(`${roleLabel(role)}의 비밀 답변이 설정됐어요.`));

  if (state.secrets.human && state.secrets.codex) {
    state.phase = "playing";
    state.turnRole = "codex";
    state.turn = 1;
    state.messages.push(
      systemMessage("두 답변이 모두 설정됐어요. Codex가 먼저 Human의 답을 좁혀볼 질문을 보냅니다."),
    );
  }

  touch();
  return { ok: true };
}

function submitTurnAction(role, kind, text) {
  const trimmed = String(text || "").trim();
  if (state.phase !== "playing") {
    return { ok: false, status: 409, error: "현재 게임 진행 중이 아니에요." };
  }

  if (state.pending) {
    return { ok: false, status: 409, error: "상대의 답변이나 판정을 기다리는 중이에요." };
  }

  if (state.turnRole !== role) {
    return { ok: false, status: 403, error: "지금은 상대 차례예요." };
  }

  if (!trimmed) {
    return { ok: false, status: 400, error: "메시지를 입력해주세요." };
  }

  if (kind !== "question" && kind !== "guess") {
    return { ok: false, status: 400, error: "지원하지 않는 동작이에요." };
  }

  const to = otherRole(role);
  const messageText =
    kind === "guess" && !trimmed.endsWith("?")
      ? `${roleLabel(to)}의 답은 ${trimmed}인가요?`
      : trimmed;

  state.pending = {
    type: kind,
    from: role,
    to,
    text: messageText,
  };
  state.messages.push(createMessage(role, messageText, kind));
  touch();
  return { ok: true };
}

function submitResponse(role, text) {
  const trimmed = String(text || "").trim();
  if (state.phase !== "playing" || !state.pending) {
    return { ok: false, status: 409, error: "답변할 질문이 없어요." };
  }

  if (state.pending.to !== role || state.pending.type !== "question") {
    return { ok: false, status: 403, error: "지금은 답변할 차례가 아니에요." };
  }

  if (!trimmed) {
    return { ok: false, status: 400, error: "답변을 입력해주세요." };
  }

  state.messages.push(createMessage(role, trimmed, "answer"));
  state.pending = null;
  state.turnRole = role;
  state.turn += 1;
  touch();
  return { ok: true };
}

function submitJudgement(role, correct) {
  if (state.phase !== "playing" || !state.pending) {
    return { ok: false, status: 409, error: "판정할 추측이 없어요." };
  }

  if (state.pending.to !== role || state.pending.type !== "guess") {
    return { ok: false, status: 403, error: "지금은 판정할 차례가 아니에요." };
  }

  const guesser = state.pending.from;
  state.messages.push(createMessage(role, correct ? "맞아요." : "아니에요.", "judge"));

  if (correct) {
    state.phase = "ended";
    state.turnRole = null;
    state.pending = null;
    state.messages.push(
      systemMessage(
        `${roleLabel(guesser)} 정답 성공!\n\nHuman의 답: ${state.secrets.human}\nCodex의 답: ${state.secrets.codex}`,
      ),
    );
  } else {
    state.pending = null;
    state.turnRole = role;
    state.turn += 1;
  }

  touch();
  return { ok: true };
}

function resetRound(sameTopic = false) {
  const nextTopic = sameTopic ? state.topic : pickTopic(state.topic.text);
  state = createState(nextTopic);
  touch();
}

function touch() {
  state.version += 1;
  broadcast();
}

function broadcast() {
  for (const client of CLIENTS) {
    client.write(`event: state\n`);
    client.write(`data: ${JSON.stringify(getPublicState(client.role))}\n\n`);
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

async function handleApi(req, res, pathname, searchParams) {
  if (req.method === "GET" && pathname === "/api/state") {
    sendJson(res, 200, getPublicState(searchParams.get("role") || "human"));
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    sendJson(res, 400, { error: "JSON 요청을 확인해주세요." });
    return;
  }

  const role = sanitizeRole(body.role);
  let result = { ok: false, status: 404, error: "Unknown endpoint" };

  if (pathname === "/api/secret") {
    result = setSecret(role, body.answer);
  } else if (pathname === "/api/action") {
    result = submitTurnAction(role, body.kind, body.text);
  } else if (pathname === "/api/answer") {
    result = submitResponse(role, body.text);
  } else if (pathname === "/api/judge") {
    result = submitJudgement(role, Boolean(body.correct));
  } else if (pathname === "/api/reset") {
    resetRound(Boolean(body.sameTopic));
    result = { ok: true };
  }

  if (!result.ok) {
    sendJson(res, result.status || 400, { error: result.error || "요청을 처리하지 못했어요." });
    return;
  }

  sendJson(res, 200, getPublicState(role));
}

function handleEvents(req, res, searchParams) {
  const role = sanitizeRole(searchParams.get("role"));
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });

  res.role = role;
  CLIENTS.add(res);
  res.write(`event: state\n`);
  res.write(`data: ${JSON.stringify(getPublicState(role))}\n\n`);

  const heartbeat = setInterval(() => {
    res.write(`event: ping\n`);
    res.write(`data: {}\n\n`);
  }, 25_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    CLIENTS.delete(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname === "/") {
    redirect(res, "/human");
    return;
  }

  if (pathname === "/human" || pathname === "/codex") {
    serveFile(res, path.join(ROOT, "index.html"), "text/html; charset=utf-8");
    return;
  }

  if (pathname === "/events") {
    handleEvents(req, res, url.searchParams);
    return;
  }

  if (pathname.startsWith("/api/")) {
    await handleApi(req, res, pathname, url.searchParams);
    return;
  }

  const staticFiles = {
    "/app.js": ["app.js", "text/javascript; charset=utf-8"],
    "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  };
  const staticFile = staticFiles[pathname];
  if (staticFile) {
    serveFile(res, path.join(ROOT, staticFile[0]), staticFile[1]);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`openai_builder server running at http://localhost:${PORT}/human`);
  console.log(`codex player screen: http://localhost:${PORT}/codex`);
});
