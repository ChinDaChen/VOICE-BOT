
import React from 'react';

interface AIAvatarProps {
  imageUrl: string | null;
  isTalking: boolean;
  isListening: boolean;
}

const AIAvatar: React.FC<AIAvatarProps> = ({ imageUrl, isTalking, isListening }) => {
  return (
    <div className="relative flex flex-col items-center justify-center py-10 transition-all duration-1000">
      {/* 多層次環形動畫 */}
      <div className={`absolute w-72 h-72 rounded-full border border-blue-500/10 transition-all duration-1000 ${isTalking ? 'scale-150 opacity-100 animate-ping' : 'scale-100 opacity-0'}`} />
      <div className={`absolute w-64 h-64 rounded-full border-2 border-blue-400/20 transition-all duration-700 ${isTalking ? 'scale-110' : 'scale-90'}`} />
      
      {/* 呼吸底光 */}
      <div className={`absolute w-60 h-60 rounded-full blur-3xl transition-all duration-1000 ${
        isTalking ? 'bg-blue-600/30' : isListening ? 'bg-green-600/20' : 'bg-slate-800/20'
      }`} />

      {/* 主頭像 */}
      <div className={`relative w-52 h-52 rounded-full overflow-hidden border-[6px] border-slate-900 shadow-[0_0_50px_rgba(0,0,0,0.5)] transition-all duration-500 ${
        isTalking ? 'border-blue-500/50 scale-105' : 'border-slate-800'
      }`}>
        {imageUrl ? (
          <img src={imageUrl} alt="AI" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-slate-900">
            <div className="animate-pulse text-blue-500/30">
              <svg className="w-24 h-24" fill="currentColor" viewBox="0 0 20 20"><path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" /></svg>
            </div>
          </div>
        )}
        {isTalking && <div className="absolute inset-0 bg-blue-500/10 animate-pulse" />}
      </div>

      {/* 狀態文字 */}
      <div className="mt-6">
        <div className={`flex items-center gap-2 px-4 py-1.5 rounded-full glass text-xs font-bold tracking-widest uppercase transition-all ${
          isTalking ? 'text-blue-400 border-blue-500/30' : isListening ? 'text-green-400 border-green-500/30' : 'text-slate-500 border-transparent'
        }`}>
          {isTalking && <span className="flex h-2 w-2 rounded-full bg-blue-400 animate-bounce"></span>}
          {isTalking ? 'Assisting...' : isListening ? 'Listening' : 'Ready'}
        </div>
      </div>
    </div>
  );
};

export default AIAvatar;
