import { useState, useRef, useEffect, useCallback } from 'react';
import Head from 'next/head';

const STORAGE_KEY = 'glasov_openai_key';

export default function Home() {
  const [apiKey, setApiKey] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [state, setState] = useState('idle'); // idle | recording | processing
  const [result, setResult] = useState('');
  const [history, setHistory] = useState([]);
  const [toast, setToast] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const toastRef = useRef(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) { setApiKey(saved); setKeySaved(true); }
  }, []);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(''), 2800);
  }, []);

  const saveKey = () => {
    const k = apiKey.trim();
    if (!k.startsWith('sk-')) { showToast('Невалиден ключ — трябва да започва с sk-'); return; }
    localStorage.setItem(STORAGE_KEY, k);
    setKeySaved(true);
    showToast('Ключът е запазен');
  };

  const getSupportedMime = () => {
    for (const t of ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4']) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
  };

  const startRecording = async () => {
    const key = localStorage.getItem(STORAGE_KEY) || apiKey;
    if (!key) { showToast('Въведи OpenAI API ключ'); return; }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];

      // Audio level analyser
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const tick = () => {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setAudioLevel(Math.min(avg / 60, 1));
        animFrameRef.current = requestAnimationFrame(tick);
      };
      tick();

      const mime = getSupportedMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => processAudio(stream, mime || 'audio/webm');
      mr.start(200);
      mediaRecorderRef.current = mr;

      setState('recording');
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    } catch {
      showToast('Няма достъп до микрофона');
    }
  };

  const stopRecording = () => {
    clearInterval(timerRef.current);
    cancelAnimationFrame(animFrameRef.current);
    setAudioLevel(0);
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current?.stream?.getTracks().forEach(t => t.stop());
    setState('processing');
  };

  const processAudio = async (stream, mimeType) => {
    stream.getTracks().forEach(t => t.stop());
    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
    const blob = new Blob(chunksRef.current, { type: mimeType });
    const key = localStorage.getItem(STORAGE_KEY) || apiKey;

    try {
      const fd = new FormData();
      fd.append('file', blob, `audio.${ext}`);
      fd.append('model', 'whisper-1');
      fd.append('language', 'bg');

      const r1 = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'x-openai-key': key },
        body: fd,
      });

      if (!r1.ok) {
        const err = await r1.json();
        throw new Error(err.error?.message || 'Whisper грешка');
      }

      const { text: raw } = await r1.json();
      if (!raw?.trim()) throw new Error('Не е разпознат текст');

      const r2 = await fetch('/api/polish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: raw }),
      });

      const { text: polished } = await r2.json();
      const final = polished || raw;

      setResult(final);
      setHistory(h => [{ text: final, time: new Date() }, ...h].slice(0, 15));
    } catch (e) {
      showToast(e.message || 'Грешка при обработване');
    }
    setState('idle');
  };

  const toggle = () => { state === 'recording' ? stopRecording() : startRecording(); };

  const copy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result);
    showToast('Копирано!');
  };

  const share = () => {
    if (!result) return;
    navigator.share ? navigator.share({ text: result }) : copy();
  };

  const fmt = d => d.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });
  const fmtTimer = s => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;

  const bars = Array.from({ length: 5 });

  return (
    <>
      <Head>
        <title>Гласов помощник</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Глас" />
        <meta name="theme-color" content="#0f0f0f" />
      </Head>

      <div className="root">
        <div className="app">

          {/* Header */}
          <div className="header">
            <div className="logo-row">
              <div className="logo-dot" />
              <span className="logo-text">гласов помощник</span>
            </div>
            <span className="lang-pill">БГ</span>
          </div>

          {/* API Key */}
          <div className="card">
            <div className="card-label">OpenAI API ключ</div>
            <div className="key-row">
              <input
                type={showKey ? 'text' : 'password'}
                placeholder="sk-proj-..."
                value={apiKey}
                onChange={e => { setApiKey(e.target.value); setKeySaved(false); }}
                className="key-input"
                autoComplete="off"
              />
              <button className="icon-btn" onClick={() => setShowKey(v => !v)} title={showKey ? 'Скрий' : 'Покажи'}>
                {showKey ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                )}
              </button>
              <button className={`save-btn ${keySaved ? 'saved' : ''}`} onClick={saveKey}>
                {keySaved ? '✓' : 'Запази'}
              </button>
            </div>
          </div>

          {/* Record button */}
          <div className="record-card">
            <button
              className={`mic-btn ${state}`}
              onClick={toggle}
              disabled={state === 'processing'}
              style={state === 'recording' ? { '--level': audioLevel } : {}}
            >
              {state === 'processing' ? (
                <div className="spinner" />
              ) : state === 'recording' ? (
                <div className="wave-bars">
                  {bars.map((_, i) => (
                    <span key={i} className="bar" style={{ '--i': i, '--h': Math.random() }} />
                  ))}
                </div>
              ) : (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="2" width="6" height="11" rx="3"/>
                  <path d="M5 10a7 7 0 0 0 14 0"/>
                  <line x1="12" y1="19" x2="12" y2="22"/>
                  <line x1="8" y1="22" x2="16" y2="22"/>
                </svg>
              )}
            </button>

            <p className={`rec-label ${state}`}>
              {state === 'idle' ? 'Натисни за запис'
               : state === 'recording' ? 'Записване — натисни за стоп'
               : 'Обработване...'}
            </p>

            {state === 'recording' && (
              <p className="timer">{fmtTimer(seconds)}</p>
            )}
          </div>

          {/* Result */}
          <div className="card result-card">
            <div className="card-label">Разпознат текст</div>
            <p className={`result-text ${!result ? 'placeholder' : ''}`}>
              {result || 'Текстът ще се появи тук след записването...'}
            </p>
            <div className="actions">
              <button className="action-btn" onClick={copy} disabled={!result}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                Копирай
              </button>
              <button className="action-btn primary" onClick={share} disabled={!result}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                Сподели
              </button>
            </div>
          </div>

          {/* History */}
          {history.length > 0 && (
            <div className="history-section">
              <div className="history-header">
                <span className="card-label">История</span>
                <button className="clear-btn" onClick={() => setHistory([])}>Изчисти</button>
              </div>
              {history.map((h, i) => (
                <div key={i} className="history-item" onClick={() => setResult(h.text)}>
                  <span className="history-time">{fmt(h.time)}</span>
                  <span className="history-preview">{h.text}</span>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>

      {/* Toast */}
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>

      <style jsx global>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; background: #0f0f0f; color: #e8e4dc; font-family: 'Georgia', serif; -webkit-font-smoothing: antialiased; }
        button { cursor: pointer; font-family: inherit; }
        input { font-family: inherit; }
      `}</style>

      <style jsx>{`
        .root { min-height: 100dvh; padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom); }
        .app { max-width: 440px; margin: 0 auto; padding: 1.5rem 1.25rem; display: flex; flex-direction: column; gap: 12px; }

        .header { display: flex; justify-content: space-between; align-items: center; padding: 4px 0 8px; }
        .logo-row { display: flex; align-items: center; gap: 8px; }
        .logo-dot { width: 8px; height: 8px; border-radius: 50%; background: #c8b89a; }
        .logo-text { font-size: 13px; letter-spacing: 0.12em; text-transform: lowercase; color: #a09880; }
        .lang-pill { font-size: 11px; letter-spacing: 0.08em; color: #6b6358; border: 0.5px solid #3a3630; padding: 3px 8px; border-radius: 20px; }

        .card { background: #171714; border: 0.5px solid #2e2b26; border-radius: 12px; padding: 1rem 1.25rem; display: flex; flex-direction: column; gap: 10px; }
        .card-label { font-size: 11px; letter-spacing: 0.1em; color: #6b6358; text-transform: uppercase; }

        .key-row { display: flex; gap: 8px; align-items: center; }
        .key-input { flex: 1; background: #0f0f0f; border: 0.5px solid #2e2b26; border-radius: 8px; padding: 8px 10px; font-size: 13px; font-family: monospace; color: #e8e4dc; outline: none; min-width: 0; }
        .key-input:focus { border-color: #5a5040; }
        .icon-btn { background: none; border: none; color: #6b6358; padding: 4px; display: flex; align-items: center; flex-shrink: 0; }
        .icon-btn:hover { color: #a09880; }
        .save-btn { background: none; border: 0.5px solid #3a3630; border-radius: 8px; padding: 7px 14px; font-size: 12px; color: #a09880; flex-shrink: 0; transition: all 0.15s; }
        .save-btn:hover { border-color: #5a5040; color: #e8e4dc; }
        .save-btn.saved { color: #8aad7a; border-color: #3a5030; }

        .record-card { background: #171714; border: 0.5px solid #2e2b26; border-radius: 16px; padding: 2.5rem 1.25rem; display: flex; flex-direction: column; align-items: center; gap: 1.25rem; }

        .mic-btn { width: 88px; height: 88px; border-radius: 50%; border: 0.5px solid #3a3630; background: #1e1c18; color: #c8b89a; display: flex; align-items: center; justify-content: center; transition: all 0.2s; position: relative; overflow: visible; }
        .mic-btn:hover:not(:disabled) { border-color: #5a5040; background: #252218; }
        .mic-btn:active:not(:disabled) { transform: scale(0.96); }
        .mic-btn.recording { border-color: #7a3a28; background: #2a1810; color: #e8866a; box-shadow: 0 0 0 calc(var(--level, 0) * 24px) rgba(200, 90, 50, 0.08); }
        .mic-btn.processing { opacity: 0.6; }
        .mic-btn:disabled { cursor: default; }

        .wave-bars { display: flex; gap: 3px; align-items: center; height: 28px; }
        .bar { display: block; width: 3px; border-radius: 2px; background: #e8866a; animation: wavebar 0.8s ease-in-out infinite; animation-delay: calc(var(--i) * 0.12s); }
        @keyframes wavebar { 0%, 100% { height: 4px; } 50% { height: 22px; } }

        .spinner { width: 22px; height: 22px; border: 1.5px solid #3a3630; border-top-color: #c8b89a; border-radius: 50%; animation: spin 0.7s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        .rec-label { font-size: 13px; color: #6b6358; letter-spacing: 0.04em; }
        .rec-label.recording { color: #c07858; }
        .rec-label.processing { color: #a09880; }
        .timer { font-size: 12px; font-family: monospace; color: #5a5040; letter-spacing: 0.05em; }

        .result-card { gap: 12px; }
        .result-text { font-size: 15px; line-height: 1.7; color: #e8e4dc; min-height: 64px; white-space: pre-wrap; word-break: break-word; }
        .result-text.placeholder { color: #3a3630; font-style: italic; font-size: 14px; }

        .actions { display: flex; gap: 8px; }
        .action-btn { flex: 1; padding: 9px 12px; border-radius: 8px; border: 0.5px solid #2e2b26; background: #0f0f0f; color: #6b6358; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.15s; }
        .action-btn:hover:not(:disabled) { border-color: #3a3630; color: #a09880; }
        .action-btn:disabled { opacity: 0.3; cursor: default; }
        .action-btn.primary { background: #1a1e14; border-color: #3a4830; color: #8aad7a; }
        .action-btn.primary:hover:not(:disabled) { background: #20261a; border-color: #4a5a38; }

        .history-section { display: flex; flex-direction: column; gap: 6px; }
        .history-header { display: flex; justify-content: space-between; align-items: center; padding: 4px 2px; }
        .clear-btn { background: none; border: none; font-size: 12px; color: #3a3630; padding: 2px; }
        .clear-btn:hover { color: #6b6358; }
        .history-item { background: #171714; border: 0.5px solid #2e2b26; border-radius: 10px; padding: 10px 14px; cursor: pointer; display: flex; flex-direction: column; gap: 4px; transition: border-color 0.15s; }
        .history-item:hover { border-color: #3a3630; }
        .history-time { font-size: 11px; font-family: monospace; color: #3a3630; }
        .history-preview { font-size: 13px; color: #6b6358; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        .toast { position: fixed; bottom: calc(24px + env(safe-area-inset-bottom)); left: 50%; transform: translateX(-50%) translateY(60px); background: #1e1c18; border: 0.5px solid #3a3630; border-radius: 20px; padding: 9px 18px; font-size: 13px; color: #a09880; transition: transform 0.25s ease; pointer-events: none; white-space: nowrap; letter-spacing: 0.02em; }
        .toast.show { transform: translateX(-50%) translateY(0); }
      `}</style>
    </>
  );
}
