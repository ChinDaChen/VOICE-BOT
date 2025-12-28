
import React, { useRef, useEffect } from 'react';

interface VisualizerProps {
  isActive: boolean;
  isModelTalking: boolean;
}

const Visualizer: React.FC<VisualizerProps> = ({ isActive, isModelTalking }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!isActive) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    const waves = 5;
    let offset = 0;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      
      for (let i = 0; i < waves; i++) {
        ctx.beginPath();
        ctx.lineWidth = 2;
        const color = isModelTalking ? `rgba(147, 197, 253, ${0.8 - i * 0.1})` : `rgba(52, 211, 153, ${0.8 - i * 0.1})`;
        ctx.strokeStyle = color;

        for (let x = 0; x < canvas.width; x++) {
          const angle = (x / canvas.width) * Math.PI * 2;
          const amplitude = isModelTalking ? 40 : (isActive ? 25 : 5);
          const y = centerY + Math.sin(angle * 2 + offset + i) * amplitude * Math.sin(offset * 0.5);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      offset += isModelTalking ? 0.15 : 0.08;
      animationId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationId);
  }, [isActive, isModelTalking]);

  return (
    <div className="relative w-full h-40 bg-slate-900 rounded-xl overflow-hidden border border-slate-800 flex items-center justify-center">
      <canvas 
        ref={canvasRef} 
        width={600} 
        height={160} 
        className="w-full h-full opacity-80"
      />
      {!isActive && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm font-medium">
          Start conversation to visualize audio
        </div>
      )}
    </div>
  );
};

export default Visualizer;
