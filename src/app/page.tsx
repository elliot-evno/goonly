"use client";
import { useState } from 'react';
import Link from 'next/link';

interface ConversationTurn {
  stewie: string;
  peter: string;
}

export default function CreatePage() {
  const [topic, setTopic] = useState('');
  const [conversation, setConversation] = useState<ConversationTurn[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      // First get the conversation
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ topic }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate conversation');
      }

      const data = await response.json();
      setConversation(data);
    } catch (err) {
      setError('Failed to generate conversation. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const playVoiceLine = async (text: string, character: 'peter' | 'stewie') => {
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          speaker: character === 'peter' 
            ? "5ccc6825-3a96-11ee-ab0d-8cec4b691ee9"
            : "53fc2766-9db6-11ef-b908-00163e020757",
          emotion: 'neutral'
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate speech');
      }

      const data = await response.json();
      new Audio(data.data.oss_url).play();
    } catch (err) {
      console.error('Failed to play audio:', err);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center p-8 bg-black">
      <h1 className="text-4xl font-bold mb-8 text-blue-600">Welcome to GoOnly</h1>
      
      {/* Form Section */}
      <form onSubmit={handleSubmit} className="w-full max-w-md mb-8">
        <div className="space-y-4">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Enter a topic for Peter and Stewie to discuss..."
            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          <button
            type="submit"
            disabled={isLoading}
            className="w-full px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-blue-300"
          >
            {isLoading ? 'Generating...' : 'Generate Conversation'}
          </button>
        </div>
      </form>

      {/* Error Message */}
      {error && (
        <div className="text-red-500 mb-4">
          {error}
        </div>
      )}

      {/* Conversation Display */}
      {conversation.length > 0 && (
        <div className="w-full max-w-2xl space-y-4">
          {conversation.map((turn, index) => (
            <div key={index} className="space-y-2">
              <div className="bg-blue-100 p-4 rounded-lg">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-blue-800">Stewie:</p>
                  <button 
                    onClick={() => playVoiceLine(turn.stewie, 'stewie')}
                    className="px-3 py-1 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
                  >
                    🔊 Play
                  </button>
                </div>
                <p className="text-blue-700">{turn.stewie}</p>
              </div>
              <div className="bg-gray-200 p-4 rounded-lg">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-gray-800">Peter:</p>
                  <button 
                    onClick={() => playVoiceLine(turn.peter, 'peter')}
                    className="px-3 py-1 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
                  >
                    🔊 Play
                  </button>
                </div>
                <p className="text-gray-700">{turn.peter}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Video Page Link */}
      <Link 
        href="/video" 
        className="mt-8 px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
      >
        Watch Video
      </Link>
    </div>
  );
}
