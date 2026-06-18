const ROLE = window.location.pathname.includes("/codex") ? "codex" : "human";
const ROLE_LABELS = {
  human: "Human",
  codex: "Codex",
};

const elements = {
  roleBadge: document.querySelector("#roleBadge"),
  topicText: document.querySelector("#topicText"),
  humanAnswerLabel: document.querySelector("#humanAnswerLabel"),
  codexAnswerLabel: document.querySelector("#codexAnswerLabel"),
  humanAnswerStatus: document.querySelector("#userAnswerStatus"),
  codexAnswerStatus: document.querySelector("#codexAnswerStatus"),
  showMyAnswerButton: document.querySelector("#showMyAnswerButton"),
  turnStatus: document.querySelector("#turnStatus"),
  turnCount: document.querySelector("#turnCount"),
  chatLog: document.querySelector("#chatLog"),
  messageTemplate: document.querySelector("#messageTemplate"),
  messageForm: document.querySelector("#messageForm"),
  messageInput: document.querySelector("#messageInput"),
  sendButton: document.querySelector("#sendButton"),
  quickActions: document.querySelector("#quickActions"),
};

let gameState = null;
let composeMode = "question";
let ownAnswerVisible = false;
let lastRenderedVersion = null;
let eventSource = null;
let pollTimer = null;

function otherRole(role = ROLE) {
  return role === "codex" ? "human" : "codex";
}

function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

function nowLabel(isoDate) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "numeric",
    minute: "2-digit",
  }).format(isoDate ? new Date(isoDate) : new Date());
}

function renderIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function iconMarkup(name, fallback = "") {
  return `<i data-lucide="${name}" aria-hidden="true">${fallback}</i>`;
}

function setQuickActions(actions, mode = "") {
  elements.quickActions.className = `quick-actions ${mode}`.trim();
  elements.quickActions.innerHTML = actions
    .map((action) => {
      const tone = action.tone ? ` ${action.tone}` : "";
      return `
        <button class="quick-action${tone}" type="button" data-action="${action.id}">
          ${iconMarkup(action.icon, action.fallback || "")}
          <span>${action.label}</span>
        </button>
      `;
    })
    .join("");
  renderIcons();
}

function statusText(role) {
  if (!gameState.answerStatus[role]) {
    return "설정 전";
  }

  if (gameState.phase === "ended" && gameState.revealedSecrets) {
    return gameState.revealedSecrets[role];
  }

  return "설정 완료";
}

function getTurnText() {
  if (!gameState) {
    return "서버 연결 중";
  }

  if (gameState.phase === "setup") {
    if (!gameState.answerStatus[ROLE]) {
      return "내 비밀 답변을 정하는 중";
    }

    return `${roleLabel(otherRole())}의 답변 대기 중`;
  }

  if (gameState.phase === "ended") {
    return "게임 종료";
  }

  const pending = gameState.pending;
  if (pending) {
    if (pending.to === ROLE) {
      return pending.type === "guess" ? "내가 정답을 판정할 차례" : "내가 답변할 차례";
    }

    return pending.type === "guess"
      ? `${roleLabel(pending.to)}의 판정 대기 중`
      : `${roleLabel(pending.to)}의 답변 대기 중`;
  }

  if (gameState.turnRole === ROLE) {
    return composeMode === "guess" ? "내가 정답을 추측하는 중" : "내가 질문할 차례";
  }

  return `${roleLabel(gameState.turnRole)}의 질문 차례`;
}

function renderHeader() {
  elements.roleBadge.textContent = `${roleLabel(ROLE)} 화면`;
  elements.topicText.textContent = gameState?.topic?.text || "주제를 불러오는 중";
  elements.humanAnswerLabel.textContent = "Human";
  elements.codexAnswerLabel.textContent = "Codex";

  if (!gameState) {
    elements.humanAnswerStatus.textContent = "확인 중";
    elements.codexAnswerStatus.textContent = "확인 중";
    elements.turnStatus.textContent = "서버 연결 중";
    elements.turnCount.textContent = "대기";
    elements.showMyAnswerButton.hidden = true;
    return;
  }

  elements.humanAnswerStatus.textContent = statusText("human");
  elements.codexAnswerStatus.textContent = statusText("codex");
  elements.turnStatus.textContent = getTurnText();
  elements.turnCount.textContent =
    gameState.turn > 0 ? `${gameState.turn}번째 턴` : "시작 전";

  elements.showMyAnswerButton.hidden = !gameState.ownSecret || gameState.phase === "ended";
  elements.showMyAnswerButton.textContent = ownAnswerVisible ? gameState.ownSecret : "내 답 보기";
}

function renderMessages() {
  if (!gameState || lastRenderedVersion === gameState.version) {
    return;
  }

  lastRenderedVersion = gameState.version;
  const shouldStickToBottom =
    elements.chatLog.scrollTop + elements.chatLog.clientHeight >= elements.chatLog.scrollHeight - 80;
  elements.chatLog.innerHTML = "";

  for (const message of gameState.messages) {
    const node = elements.messageTemplate.content.firstElementChild.cloneNode(true);
    const isSystem = message.role === "system";
    const isMine = message.role === ROLE;
    const className = isSystem ? "system" : isMine ? "user" : "codex";
    node.classList.add(className);

    if (!isSystem && message.role === "human") {
      node.classList.add("human-role");
    }

    const speakerNode = node.querySelector(".speaker");
    const bubbleNode = node.querySelector(".bubble");
    const timeNode = node.querySelector(".message-time");
    speakerNode.textContent = isSystem ? "" : isMine ? "나" : roleLabel(message.role);
    bubbleNode.textContent = message.text;
    timeNode.textContent = nowLabel(message.createdAt);
    elements.chatLog.append(node);
  }

  if (shouldStickToBottom || gameState.phase === "ended") {
    elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
    window.requestAnimationFrame(() => {
      elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
    });
  }
}

function setComposerDisabled(placeholder) {
  elements.messageInput.value = "";
  elements.messageInput.placeholder = placeholder;
  elements.messageInput.disabled = true;
  elements.sendButton.disabled = true;
}

function renderSetupComposer() {
  if (gameState.answerStatus[ROLE]) {
    setComposerDisabled(`${roleLabel(otherRole())}의 비밀 답변을 기다리는 중`);
    setQuickActions([
      { id: "new-round", label: "새 라운드", icon: "rotate-ccw", fallback: "↻", tone: "is-teal" },
      { id: "same-topic", label: "같은 주제", icon: "repeat", fallback: "↺" },
    ]);
    elements.quickActions.classList.add("result-actions");
    return;
  }

  elements.messageInput.disabled = false;
  elements.sendButton.disabled = false;
  elements.messageInput.placeholder = "내 비밀 답변을 입력하세요";
  setQuickActions([
    { id: "fill-example", label: "예시 답", icon: "sparkles", fallback: "*" },
    { id: "set-secret", label: "답변 설정", icon: "lock-keyhole", fallback: "!" },
    { id: "new-round", label: "새 주제", icon: "refresh-cw", fallback: "↻", tone: "is-teal" },
  ]);
}

function renderTurnComposer() {
  const opponent = roleLabel(otherRole());

  if (gameState.pending) {
    const pending = gameState.pending;

    if (pending.to !== ROLE) {
      setComposerDisabled(
        pending.type === "guess"
          ? `${roleLabel(pending.to)}의 판정을 기다리는 중`
          : `${roleLabel(pending.to)}의 답변을 기다리는 중`,
      );
      setQuickActions([]);
      return;
    }

    if (pending.type === "guess") {
      setComposerDisabled(`${opponent}의 추측을 판정해주세요`);
      setQuickActions(
        [
          { id: "judge-correct", label: "맞아요", icon: "check", fallback: "✓", tone: "is-teal" },
          { id: "judge-wrong", label: "아니에요", icon: "x", fallback: "×", tone: "is-danger" },
        ],
        "result-actions",
      );
      return;
    }

    elements.messageInput.disabled = false;
    elements.sendButton.disabled = false;
    elements.messageInput.placeholder = `${opponent}의 질문에 답해주세요`;
    setQuickActions([
      { id: "quick-yes", label: "맞아요", icon: "check", fallback: "✓", tone: "is-teal" },
      { id: "quick-no", label: "아니에요", icon: "x", fallback: "×", tone: "is-danger" },
      { id: "quick-close", label: "비슷해요", icon: "git-compare", fallback: "~" },
      { id: "quick-different", label: "조금 달라요", icon: "corner-down-right", fallback: ">" },
      { id: "give-hint", label: "힌트 줄게요", icon: "lightbulb", fallback: "!" },
    ]);
    return;
  }

  if (gameState.turnRole !== ROLE) {
    setComposerDisabled(`${roleLabel(gameState.turnRole)}의 질문을 기다리는 중`);
    setQuickActions([]);
    return;
  }

  elements.messageInput.disabled = false;
  elements.sendButton.disabled = false;
  elements.messageInput.placeholder =
    composeMode === "guess"
      ? `${opponent}의 비밀 답변을 추측해보세요`
      : `${opponent}의 답을 좁힐 질문을 입력해보세요`;
  setQuickActions(
    composeMode === "guess"
      ? [
          { id: "submit-guess", label: "이 답으로 추측하기", icon: "target", fallback: "◎", tone: "is-teal" },
          { id: "question-mode", label: "질문 더 하기", icon: "message-circle", fallback: "?" },
        ]
      : [
          { id: "question-mode", label: "질문 보내기", icon: "circle-help", fallback: "?" },
          { id: "guess-mode", label: "정답 추측하기", icon: "target", fallback: "◎", tone: "is-teal" },
        ],
    composeMode === "guess" ? "result-actions" : "",
  );
}

function renderComposer() {
  if (!gameState) {
    setComposerDisabled("서버에 연결하는 중");
    setQuickActions([]);
    return;
  }

  if (gameState.phase === "setup") {
    renderSetupComposer();
    return;
  }

  if (gameState.phase === "ended") {
    setComposerDisabled("게임이 종료되었어요");
    setQuickActions(
      [
        { id: "new-round", label: "새 주제", icon: "rotate-ccw", fallback: "↻", tone: "is-teal" },
        { id: "same-topic", label: "같은 주제", icon: "repeat", fallback: "↺" },
      ],
      "result-actions",
    );
    return;
  }

  renderTurnComposer();
}

function render() {
  renderHeader();
  renderMessages();
  renderComposer();
  renderIcons();
}

async function postJson(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role: ROLE, ...payload }),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "요청을 처리하지 못했어요.");
  }

  return data;
}

async function refreshState() {
  const response = await fetch(`/api/state?role=${ROLE}`);
  const nextState = await response.json();
  if (nextState.version !== gameState?.version) {
    gameState = nextState;
    render();
    return;
  }

  gameState = nextState;
  renderHeader();
  renderComposer();
}

function bumpInput(message) {
  elements.messageInput.classList.remove("is-shaking");
  void elements.messageInput.offsetWidth;
  elements.messageInput.classList.add("is-shaking");
  elements.messageInput.focus();

  if (message) {
    elements.messageInput.placeholder = message;
  }
}

async function safePost(path, payload) {
  try {
    const nextState = await postJson(path, payload);
    gameState = nextState;
    ownAnswerVisible = false;
    render();
  } catch (error) {
    bumpInput(error.message);
  }
}

function currentText() {
  return elements.messageInput.value.trim();
}

async function submitSecret() {
  const answer = currentText();
  if (!answer) {
    bumpInput("비밀 답변을 입력해주세요");
    return;
  }

  elements.messageInput.value = "";
  await safePost("/api/secret", { answer });
}

async function submitQuestionOrGuess() {
  const text = currentText();
  if (!text) {
    bumpInput(composeMode === "guess" ? "추측할 답을 입력해주세요" : "질문을 입력해주세요");
    return;
  }

  elements.messageInput.value = "";
  await safePost("/api/action", {
    kind: composeMode,
    text,
  });
}

async function submitAnswer(text = currentText()) {
  const answer = text.trim();
  if (!answer) {
    bumpInput("답변을 입력해주세요");
    return;
  }

  elements.messageInput.value = "";
  await safePost("/api/answer", { text: answer });
}

async function submitJudgement(correct) {
  await safePost("/api/judge", { correct });
}

async function resetRound(sameTopic = false) {
  elements.messageInput.value = "";
  composeMode = "question";
  ownAnswerVisible = false;
  await safePost("/api/reset", { sameTopic });
}

function handleSubmit(event) {
  event.preventDefault();

  if (!gameState) {
    return;
  }

  if (gameState.phase === "setup") {
    submitSecret();
    return;
  }

  if (gameState.phase !== "playing") {
    return;
  }

  if (gameState.pending?.to === ROLE && gameState.pending.type === "question") {
    submitAnswer();
    return;
  }

  if (!gameState.pending && gameState.turnRole === ROLE) {
    submitQuestionOrGuess();
  }
}

function handleQuickAction(action) {
  const quickAnswerMap = {
    "quick-yes": "맞아요.",
    "quick-no": "아니에요.",
    "quick-close": "비슷해요.",
    "quick-different": "조금 달라요.",
  };

  if (quickAnswerMap[action]) {
    submitAnswer(quickAnswerMap[action]);
    return;
  }

  if (action === "give-hint") {
    elements.messageInput.value = "힌트를 줄게요. ";
    elements.messageInput.focus();
    return;
  }

  if (action === "fill-example") {
    elements.messageInput.value = gameState.topic.examples[0] || "";
    elements.messageInput.focus();
    return;
  }

  if (action === "set-secret") {
    submitSecret();
    return;
  }

  if (action === "question-mode") {
    composeMode = "question";
    render();
    elements.messageInput.focus();
    return;
  }

  if (action === "guess-mode") {
    composeMode = "guess";
    elements.messageInput.value = "";
    render();
    elements.messageInput.focus();
    return;
  }

  if (action === "submit-guess") {
    submitQuestionOrGuess();
    return;
  }

  if (action === "judge-correct") {
    submitJudgement(true);
    return;
  }

  if (action === "judge-wrong") {
    submitJudgement(false);
    return;
  }

  if (action === "new-round") {
    resetRound(false);
    return;
  }

  if (action === "same-topic") {
    resetRound(true);
  }
}

function connectEvents() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource(`/events?role=${ROLE}`);

  eventSource.addEventListener("state", (event) => {
    const nextState = JSON.parse(event.data);
    if (nextState.version !== gameState?.version) {
      gameState = nextState;
      composeMode = "question";
      ownAnswerVisible = false;
      render();
    }
    elements.roleBadge.textContent = `${roleLabel(ROLE)} 화면`;
  });

  eventSource.onerror = () => {
    elements.roleBadge.textContent = `${roleLabel(ROLE)} 연결 재시도 중`;
  };
}

function startPolling() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
  }

  pollTimer = window.setInterval(() => {
    refreshState().catch(() => {
      elements.roleBadge.textContent = `${roleLabel(ROLE)} 연결 재시도 중`;
    });
  }, 800);
}

elements.messageForm.addEventListener("submit", handleSubmit);
elements.quickActions.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  handleQuickAction(button.dataset.action);
});

elements.showMyAnswerButton.addEventListener("click", () => {
  ownAnswerVisible = !ownAnswerVisible;
  renderHeader();
});

refreshState()
  .then(() => {
    connectEvents();
    startPolling();
  })
  .catch(() => {
    elements.roleBadge.textContent = `${roleLabel(ROLE)} 연결 실패`;
    bumpInput("서버를 먼저 실행해주세요");
  });
