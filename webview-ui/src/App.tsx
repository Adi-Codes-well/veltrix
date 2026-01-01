import { useState, useEffect, useRef } from 'react';
import { vscode } from './utilities/vscode';
import './App.css'; // Assume basic styling exists

type Message = { role: 'user' | 'assistant'; content: string };

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  // Auto-scroll to bottom
  const bottomRef = useRef<HTMLDivElement>(null);

  const handleMessage = (event: MessageEvent) => {
    const message = event.data;
    switch (message.type) {
      case 'onToken':
        // Update the last message (the assistant's) with the new chunk
        setMessages((prev) => {
          const newHistory = [...prev];
          const lastMsg = newHistory[newHistory.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            lastMsg.content += message.value;
            return newHistory;
          } else {
            return [...prev, { role: 'assistant', content: message.value }];
          }
        });
        break;
      case 'onComplete':
        setIsLoading(false);
        break;
    }
  };
  
  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  

  const sendMessage = () => {
    if (!input.trim()) return;
    
    // Add user message to UI immediately
    setMessages((prev) => [...prev, { role: 'user', content: input }]);
    // Prepare for AI response
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);
    
    setIsLoading(true);
    vscode.postMessage({ command: 'chat', text: input });
    setInput('');
  };

  return (
    <div className="container">
      <div className="messages">
        {messages.map((m, i) => (
          <div key={i} className={`message ${m.role}`}>
            {m.content}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="input-area">
        <textarea 
          value={input} 
          onChange={(e) => setInput(e.target.value)} 
          disabled={isLoading}
        />
        <button onClick={sendMessage} disabled={isLoading}>Send</button>
      </div>
    </div>
  );
}

export default App;