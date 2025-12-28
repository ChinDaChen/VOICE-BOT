
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { KnowledgeFile, SessionStatus } from './types';
import { decode, decodeAudioData, createBlob } from './utils/audio-utils';
import AIAvatar from './components/AIAvatar';

declare var google: any;
declare var gapi: any;

// 您的 Google Client ID
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
      if (typeof gapi !== 'undefined' && typeof google !== 'undefined') {
        gapi.load('picker', { 'callback': () => console.log('Picker API Ready') });
      } else {
        setTimeout(initGapi, 500);
      }
    };
    initGapi();
  }, []);

  const generateAvatar = async (context?: string) => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = context 
        ? `A high-tech cinematic portrait of an AI robot specialist in ${context}, neon blue lighting, digital background.` 
        : `A professional and friendly AI assistant avatar, minimalist crystal style.`;
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: [{ text: prompt }] },
      });
      const part = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
      if (part?.inlineData?.data) setAvatarUrl(`data:image/png;base64,${part.inlineData.data}`);
    } catch (e) { console.error("Avatar Gen Error:", e); }
  };

  const handleGoogleDriveAction = () => {
    if (!CLIENT_ID || CLIENT_ID.includes('YOUR_GOOGLE')) {
      alert("請填寫有效的 Client ID。");
      return;
    }
    setIsProcessing(true);
    try {
      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: async (response: any) => {
          if (response.error !== undefined) {
            setIsProcessing(false);
            console.error("Auth Error:", response);
            alert(`授權失敗: ${response.error}`);
            return;
          }
          createPicker(response.access_token);
        },
      });
      tokenClient.requestAccessToken({ prompt: 'consent' });
    } catch (err) {
      setIsProcessing(false);
      alert("Google 授權初始化失敗，請確認已在 Cloud Console 加入目前的網址作為授權來源。");
    }
  };

  const createPicker = (accessToken: string) => {
    try {
      const picker = new google.picker.PickerBuilder()
        .addView(new google.picker.DocsView().setMimeTypes('application/pdf'))
        .setOAuthToken(accessToken)
        .setDeveloperKey(process.env.API_KEY)
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
      console.error("Picker Error:", err);
    }
  };

  const processDriveFile = async (fileId: string, fileName: string, accessToken: string) => {
    try {
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      if (!response.ok) throw new Error("Fetch failed");
      const blob = await response.blob();
      const base64Data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(blob);
      });

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const res = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts: [{ inlineData: { data: base64Data, mimeType: 'application/pdf' } }, { text: "Provide a detailed summary and extract key facts from this PDF for a knowledge base." }] },
      });

      setFiles(prev => [...prev, { id: fileId, name: fileName, content: res.text || "No content extracted.", size: blob.size }]);
      setIsProcessing(false);
      generateAvatar(fileName);
    } catch (err) {
      setIsProcessing(false);
      alert("讀取雲端檔案失敗，請確保已在 Google Cloud 啟用 Drive API。");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Data = (event.target?.result as string).split(',')[1];
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      try {
        const res = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: { parts: [{ inlineData: { data: base64Data, mimeType: file.type } }, { text: "Summarize everything in this document clearly." }] },
        });
        setFiles(prev => [...prev, { id: Math.random().toString(), name: file.name, content: res.text || "", size: file.size }]);
        generateAvatar(file.name);
      } catch (err) {
        console.error(err);
        alert("PDF 處理失敗，請檢查 API Key 是否正確。");
      }
      setIsProcessing(false);
    };
    reader.readAsDataURL(file);
  };

  const startVoiceSession = async (initialMsg?: string) => {
    if (status !== SessionStatus.IDLE) return;
    setStatus(SessionStatus.CONNECTING);
    setCurrentResponse('');
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const context = files.length > 0 
        ? files.map(f => `[DOCUMENT: ${f.name}]\n${f.content}`).join('\n\n')
        : "No documents uploaded yet.";
      
      const systemInstruction = `You are a Knowledge Expert AI. 
      CURRENT KNOWLEDGE BASE:
      ${context}

      INSTRUCTIONS:
      1. Use the provided knowledge base to answer questions.
      2. If the answer is not in the documents, say you don't know based on the files.
      3. Keep responses concise (max 3 sentences).
      4. Use a natural, friendly tone. No markdown or special symbols.`;
      
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
              const newText = msg.serverContent.outputTranscription.text;
              setCurrentResponse(prev => prev + newText);
            }

            if (msg.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => { try { s.stop(); } catch(e){} });
              sourcesRef.current.clear();
              setIsModelTalking(false);
            }
          },
          onclose: () => {
            setStatus(SessionStatus.IDLE);
            setIsModelTalking(false);
          },
          onerror: (e) => { 
            console.error("Session Error:", e); 
            setStatus(SessionStatus.ERROR); 
          }
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e) {
      console.error("Start Session Error:", e);
      setStatus(SessionStatus.ERROR);
      alert("無法啟動語音工作階段，請確認麥克風權限。");
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
    <div className="h-screen w-screen flex flex-col md:flex-row bg-slate-950 text-white font-['Inter']">
      <aside className="w-full md:w-72 glass border-r border-slate-800 p-6 flex flex-col z-30">
        <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent mb-8">WiseVoice AI</h1>
        
        <div className="space-y-6 flex-1 overflow-y-auto pr-2 custom-scrollbar">
          <section>
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Add Knowledge</h3>
            <div className="flex flex-col gap-2">
              <label className="cursor-pointer bg-slate-800/40 hover:bg-slate-700/60 p-3 rounded-xl border border-slate-700/50 flex items-center gap-3 transition-all">
                <input type="file" accept=".pdf" className="hidden" onChange={handleFileUpload} />
                <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                <span className="text-xs">Upload PDF</span>
              </label>
              <button 
                onClick={handleGoogleDriveAction}
                disabled={isProcessing}
                className="bg-slate-800/40 hover:bg-slate-700/60 p-3 rounded-xl border border-slate-700/50 flex items-center gap-3 transition-all disabled:opacity-50"
              >
                {isProcessing ? <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent animate-spin rounded-full" /> : <svg className="w-4 h-4 text-indigo-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12.5 5H11v4H7v1.5h4V15h1.5v-4.5h4V9h-4V5z"/></svg>}
                <span className="text-xs">{isProcessing ? 'Processing...' : 'Google Drive'}</span>
              </button>
            </div>
          </section>

          <section>
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Knowledge Base ({files.length})</h3>
            <div className="space-y-2">
              {files.map(f => (
                <div key={f.id} className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/50 text-[11px] flex justify-between items-center group">
                  <span className="truncate flex-1 pr-2">{f.name}</span>
                  <div className="w-2 h-2 rounded-full bg-blue-500 group-hover:animate-pulse" />
                </div>
              ))}
              {files.length === 0 && <p className="text-[10px] text-slate-600 italic px-1">Please add PDF assets...</p>}
            </div>
          </section>
        </div>
        
        <div className="mt-4 pt-4 border-t border-slate-800">
           <p className="text-[9px] text-slate-600 text-center uppercase tracking-tighter">Powered by Gemini 2.5 Live</p>
        </div>
      </aside>

      <main className="flex-1 relative flex flex-col items-center justify-center p-6">
        <div className="z-10 transform scale-90 md:scale-100">
           <AIAvatar imageUrl={avatarUrl} isTalking={isModelTalking} isListening={status === SessionStatus.ACTIVE} />
        </div>
        
        <div className="mt-8 h-40 flex flex-col items-center justify-center text-center max-w-2xl z-10 px-4">
          {lastUserText && <p className="text-blue-400/60 text-sm mb-3 italic animate-pulse">"{lastUserText}"</p>}
          <div className="min-h-[2rem]">
            <p className="text-xl md:text-2xl font-medium leading-relaxed bg-gradient-to-b from-white to-slate-400 bg-clip-text text-transparent">
              {currentResponse || (status === SessionStatus.ACTIVE ? "Listening..." : status === SessionStatus.CONNECTING ? "Connecting to AI..." : "Ready to Answer from PDF")}
            </p>
          </div>
        </div>

        <div className="absolute bottom-10 w-full max-w-lg px-6 flex flex-col items-center gap-6 z-50">
          <form onSubmit={handleSendMessage} className="w-full flex gap-2 glass p-2 rounded-2xl border border-white/10 shadow-2xl bg-slate-900/90 focus-within:border-blue-500/50 transition-all">
            <input 
              type="text" 
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Ask a question about your files..."
              className="flex-1 bg-transparent border-none focus:ring-0 text-sm px-4 py-3 text-white placeholder-slate-500"
            />
            <button type="submit" className="px-5 bg-blue-600 rounded-xl hover:bg-blue-500 transition-all flex items-center justify-center shadow-lg active:scale-95">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
            </button>
          </form>

          <div className="flex flex-col items-center gap-3">
            <button
              onClick={status === SessionStatus.ACTIVE ? stopVoiceSession : () => startVoiceSession()}
              disabled={status === SessionStatus.CONNECTING}
              className={`w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-[0_0_30px_rgba(37,99,235,0.3)] ring-4 ring-white/5 active:scale-90 ${
                status === SessionStatus.ACTIVE ? 'bg-red-500 ring-red-500/20' : 'bg-blue-600 hover:scale-110'
              }`}
            >
              {status === SessionStatus.ACTIVE ? 
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" /></svg> : 
                status === SessionStatus.CONNECTING ? 
                <div className="w-6 h-6 border-2 border-white border-t-transparent animate-spin rounded-full" /> :
                <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20"><path d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" /></svg>
              }
            </button>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
              {status === SessionStatus.ACTIVE ? 'End Session' : 'Start Voice Chat'}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
