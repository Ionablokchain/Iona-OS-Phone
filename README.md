# IONA OS Phone

React Native (Expo) mobile simulator for IONA OS — a bare-metal Rust blockchain OS.

## Structure

```
iona-os-phone/
├── backend/          FastAPI + MongoDB API
│   ├── server.py
│   ├── .env
│   ├── requirements.txt
│   └── tests/
└── frontend/         Expo Router React Native app
    ├── app/
    │   ├── index.tsx           Lock screen
    │   ├── _layout.tsx         Root layout
    │   └── (os)/               OS screens
    │       ├── home.tsx
    │       ├── wallet.tsx
    │       ├── nodes.tsx
    │       ├── settings.tsx
    │       ├── phone.tsx
    │       ├── messages.tsx
    │       ├── conversation.tsx
    │       ├── contacts.tsx
    │       ├── terminal.tsx
    │       ├── browser.tsx
    │       ├── calculator.tsx
    │       ├── calendar.tsx
    │       ├── camera.tsx
    │       └── game.tsx
    ├── src/
    │   ├── theme.ts
    │   ├── context/AuthContext.tsx
    │   └── utils/api.ts
    └── assets/

## Quick Start

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn server:app --reload
```

### Frontend
```bash
cd frontend
yarn install
yarn start
```

## Default Credentials
- Username: `iona`
- PIN: `1234`

## Design System
Brutalist dark OS UI — "Control Room" protocol.
Colors: `#050505` background, `#FF4B00` accent, `#00FF41` success.
Font: SpaceMono (monospace), zero border-radius, 1px grid borders.
