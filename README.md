# openai_builder

## 코덱스, 나를 맞혀봐

`docs.md`를 기반으로 만든 채팅형 양방향 스무고개 게임 MVP입니다.

실행 방법:

```powershell
npm run dev
```

또는 Node를 직접 실행합니다.

```powershell
node server.js
```

접속 주소:

- Human 화면: http://localhost:5173/human
- Codex 화면: http://localhost:5173/codex

두 화면은 하나의 게임 상태를 공유합니다. 각 화면에서 사람이 직접 비밀 답변, 질문, 답변, 정답 판정을 입력합니다.
