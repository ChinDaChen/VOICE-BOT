
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { KnowledgeFile, SessionStatus } from './types';
import { decode, decodeAudioData, createBlob } from './utils/audio-utils';
import AIAvatar from './components/AIAvatar';

// 修正：為瀏覽器環境提供 process.env 安全檢查，防止白畫面
const safeGetApiKey = () => {
  try {
    return process.env.API_KEY || (window as any).process?.env?.API_KEY || '';
  } catch {
    return '';
  }
};

declare var google: any;
declare var gapi: any;

const CLIENT_ID = '5918080408-j58nta6v9ib3h9sbaoghkjk03h7ofp5k.apps.googleusercontent.com'; 
const SCOPES = 'https://www.googleapis.com/auth/drive.readonly';

const App: React.FC = () => {
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [status, setStatus] = useState<SessionStatus>(SessionStatus.IDLE);
  const [lastUserText, setLastUserText] = useState('');
  const [currentResponse, setCurrentResponse] = useState('');
  const [isModelTalking, setIsModelTalking] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [inputText, setInputText] = useState('');

  const sessionRef = useRef<any>(null);
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const audioContextInRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    generateAvatar();
    const initGapi = () => {
      // 確保 google 和 gapi 物件都已載入
      if (typeof gapi !== 'undefined' && typeof google !== 'undefined' && google.accounts) {
        gapi.load('picker', { 'callback': () => console.log('Picker API Ready') });
      } else {
        setTimeout(initGapi, 1000);
      }
    };
    initGapi();
  }, []);

  const generateAvatar = async (context?: string) => {
    const apiKey = safeGetApiKey();
    if (!apiKey) return;
    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = context 
        ? `A futuristic 3D orb, pulsating blue light, representing knowledge base: ${context}.` 
        : `A high-quality 3D digital brain avatar, glowing neon circuits, professional look.`;
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: [{ text: prompt }] },
      });
      const part = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
      if (part?.inlineData?.data) setAvatarUrl(`data:image/png;base64,${part.inlineData.data}`);
    } catch (e) { 
      console.warn("Avatar service unavailable"); 
    }
  };

  const handleGoogleDriveAction = () => {
    if (typeof google === 'undefined' || !google.accounts) {
      alert("Google 服務載入中，請稍後再試。");
      return;
    }
    setIsProcessing(true);
    try {
      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: async (response: any) => {
          if (response.error) {
            setIsProcessing(false);
            console.error(response);
            return;
          }
          createPicker(response.access_token);
        },
      });
      tokenClient.requestAccessToken({ prompt: 'consent' });
    } catch (err) {
      setIsProcessing(false);
      alert("請確認已在 Google Cloud 設定正確的 JavaScript 來源。");
    }
  };

  const createPicker = (accessToken: string) => {
    try {
      const picker = new google.picker.PickerBuilder()
        .addView(new google.picker.DocsView().setMimeTypes('application/pdf'))
        .setOAuthToken(accessToken)
        .setDeveloperKey(safeGetApiKey())
        .setCallback(async (data: any) => {
          if (data.action === google.picker.Action.PICKED) {
            const doc = data.docs[0];
            await processDriveFile(doc.id, doc.name, accessToken);
          } else if (data.action === 'cancel' || data.action === 'close') {
            setIsProcessing(false);
          }
        })
        .build();
      picker.setVisible(true);
    } catch (err) {
      setIsProcessing(false);
    }
  };

  const processDriveFile = async (fileId: string, fileName: string, accessToken: string) => {
    const apiKey = safeGetApiKey();
    try {
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      const blob = await response.blob();
      const base64Data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(blob);
      });

      const ai = new GoogleGenAI({ apiKey });
      const res = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts: [{ inlineData: { data: base64Data, mimeType: 'application/pdf' } }, { text: "Summarize this PDF knowledge base in detail." }] },
      });

      setFiles(prev => [...prev, { id: fileId, name: fileName, content: res.text || "", size: blob.size }]);
      setIsProcessing(false);
      generateAvatar(fileName);
    } catch (err) {
      setIsProcessing(false);
      alert("PDF 解析失敗。");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Data = (event.target?.result as string).split(',')[1];
      const apiKey = safeGetApiKey();
      try {
        const ai = new GoogleGenAI({ apiKey });
        const res = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: { parts: [{ inlineData: { data: base64Data, mimeType: file.type } }, { text: "Summarize the key knowledge." }] },
        });
        setFiles(prev => [...prev, { id: Math.random().toString(), name: file.name, content: res.text || "", size: file.size }]);
        generateAvatar(file.name);
      } catch (err) {
        alert("手動上傳失敗，請檢查 API KEY。");
      }
      setIsProcessing(false);
    };
    reader.readAsDataURL(file);
  };

  const startVoiceSession = async (initialMsg?: string) => {
    const apiKey = safeGetApiKey();
    if (!apiKey) {
      alert("請在 Vercel 設定中加入 API_KEY 環境變數。");
      setStatus(SessionStatus.IDLE);
      return;
    }
    if (status !== SessionStatus.IDLE) return;
    setStatus(SessionStatus.CONNECTING);
    setCurrentResponse('');
    
    try {
      const ai = new GoogleGenAI({ apiKey });
      // 限制內容長度防止超載
      const context = files.map(f => f.content).join('\n').substring(0, 10000);
      const systemInstruction = `You are a helper. Knowledge base:\n${context}\nAnswer based on this. Be brief. Chinese allowed.`;
      
      const audioContextOut = new AudioContext({ sampleRate: 24000 });
      audioContextOutRef.current = audioContextOut;
      const outputNode = audioContextOut.createGain();
      outputNode.connect(audioContextOut.destination);

      const audioContextIn = new AudioContext({ sampleRate: 16000 });
      audioContextInRef.current = audioContextIn;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction,
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setStatus(SessionStatus.ACTIVE);
            audioContextIn.resume();
            audioContextOut.resume();
            
            const source = audioContextIn.createMediaStreamSource(stream);
            const scriptProcessor = audioContextIn.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (ev) => {
              const data = ev.inputBuffer.getChannelData(0);
              sessionPromise.then(s => s.sendRealtimeInput({ media: createBlob(data) }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextIn.destination);

            if (initialMsg) {
              sessionPromise.then(s => (s as any).send({ parts: [{ text: initialMsg }] }));
            }
          },
          onmessage: async (msg: LiveServerMessage) => {
            const base64Audio = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              setIsModelTalking(true);
              const audioBuffer = await decodeAudioData(decode(base64Audio), audioContextOut, 24000, 1);
              const source = audioContextOut.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputNode);
              source.onended = () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) setIsModelTalking(false);
              };
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioContextOut.currentTime);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            if (msg.serverContent?.outputTranscription) {
              setCurrentResponse(prev => prev + msg.serverContent!.outputTranscription!.text);
            }
          },
          onclose: () => setStatus(SessionStatus.IDLE),
          onerror: (e) => setStatus(SessionStatus.ERROR)
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e) {
      setStatus(SessionStatus.ERROR);
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    const msg = inputText;
    setInputText('');
    setLastUserText(msg);
    setCurrentResponse('');
    if (sessionRef.current && status === SessionStatus.ACTIVE) {
      (sessionRef.current as any).send({ parts: [{ text: msg }] });
    } else {
      startVoiceSession(msg);
    }
  };

  const stopVoiceSession = () => {
    if (sessionRef.current) sessionRef.current.close();
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    setStatus(SessionStatus.IDLE);
    setIsModelTalking(false);
  };

  return (
    <div className="h-screen w-screen flex flex-col md:flex-row bg-slate-950 text-white font-['Inter'] overflow-hidden">
      <aside className="w-full md:w-72 glass border-r border-slate-800 p-6 flex flex-col z-30">
        <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent mb-8">WiseVoice AI</h1>
        <div className="space-y-6 flex-1 overflow-y-auto pr-2 custom-scrollbar">
          <section>
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Knowledge Source</h3>
            <div className="flex flex-col gap-2">
              <label className="cursor-pointer bg-slate-800/40 hover:bg-slate-700/60 p-3 rounded-xl border border-slate-700/50 flex items-center gap-3 transition-all">
                <input type="file" accept=".pdf" className="hidden" onChange={handleFileUpload} />
                <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                <span className="text-xs">Local PDF</span>
              </label>
              <button onClick={handleGoogleDriveAction} disabled={isProcessing} className="bg-slate-800/40 hover:bg-slate-700/60 p-3 rounded-xl border border-slate-700/50 flex items-center gap-3 transition-all disabled:opacity-50">
                {isProcessing ? <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent animate-spin rounded-full" /> : <svg className="w-4 h-4 text-indigo-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12.5 5H11v4H7v1.5h4V15h1.5v-4.5h4V9h-4V5z"/></svg>}
                <span className="text-xs">Google Drive</span>
              </button>
            </div>
          </section>
          <section>
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Knowledge Base ({files.length})</h3>
            <div className="space-y-2">
              {files.map(f => (
                <div key={f.id} className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/50 text-[11px] flex justify-between items-center">
                  <span className="truncate flex-1 pr-2">{f.name}</span>
                  <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                </div>
              ))}
              {files.length === 0 && <p className="text-[10px] text-slate-600 italic">No files loaded...</p>}
            </div>
          </section>
        </div>
      </aside>
      <main className="flex-1 relative flex flex-col items-center justify-center p-6 bg-[radial-gradient(circle_at_center,_#1e293b_0%,_#020617_100%)]">
        <AIAvatar imageUrl={avatarUrl} isTalking={isModelTalking} isListening={status === SessionStatus.ACTIVE} />
        <div className="mt-8 h-40 flex flex-col items-center justify-center text-center max-w-2xl z-10 px-4">
          {lastUserText && <p className="text-blue-400/40 text-sm mb-2 italic">"{lastUserText}"</p>}
          <p className="text-xl md:text-2xl font-medium bg-gradient-to-b from-white to-slate-400 bg-clip-text text-transparent">
            {currentResponse || (status === SessionStatus.ACTIVE ? "I am listening..." : status === SessionStatus.ERROR ? "API Key Error" : "Ready to assist")}
          </p>
        </div>
        <div className="absolute bottom-10 w-full max-w-lg px-6 flex flex-col items-center gap-6 z-50">
          <form onSubmit={handleSendMessage} className="w-full flex gap-2 glass p-2 rounded-2xl border border-white/10 shadow-2xl bg-slate-900/90 focus-within:border-blue-500/50 transition-all">
            <input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder="Type a question..." className="flex-1 bg-transparent border-none focus:ring-0 text-sm px-4 py-3 text-white placeholder-slate-500" />
            <button type="submit" className="px-5 bg-blue-600 rounded-xl hover:bg-blue-500 transition-all active:scale-95"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg></button>
          </form>
          <button onClick={status === SessionStatus.ACTIVE ? stopVoiceSession : () => startVoiceSession()} className={`w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-2xl ring-4 ring-white/5 ${status === SessionStatus.ACTIVE ? 'bg-red-500' : 'bg-blue-600 hover:scale-110'}`}>
            {status === SessionStatus.ACTIVE ? <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" /></svg> : status === SessionStatus.CONNECTING ? <div className="w-6 h-6 border-2 border-white border-t-transparent animate-spin rounded-full" /> : <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20"><path d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" /></svg>}
          </button>
        </div>
      </main>
    </div>
  );
};

export default App;
