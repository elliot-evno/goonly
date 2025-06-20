"use client";
import { useState } from 'react';
import Link from 'next/link';

interface ConversationTurn {
  stewie: string;
  peter: string;
}

interface AudioPart {
  url: string;
  startTime: number;
  duration: number;
  character: 'stewie' | 'peter';
  text: string;
}

export default function CreatePage() {
  const [topic, setTopic] = useState('');
  const [conversation, setConversation] = useState<ConversationTurn[]>([]);
  const [audioParts, setAudioParts] = useState<AudioPart[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
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

  const generateFullConversation = async () => {
    setIsGeneratingAudio(true);
    const parts: AudioPart[] = [];
    let currentTime = 0;
    const GAP_BETWEEN_LINES = 1; // 1 second gap between lines

    try {
      for (const turn of conversation) {
        // Generate Stewie's line
        const stewieResponse = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: turn.stewie,
            speaker: "53fc2766-9db6-11ef-b908-00163e020757",
            emotion: 'neutral'
          }),
        });
        
        if (!stewieResponse.ok) throw new Error('Failed to generate Stewie speech');
        const stewieData = await stewieResponse.json();
        
        parts.push({
          url: stewieData.data.oss_url,
          startTime: currentTime,
          duration: stewieData.data.duration || 2, // fallback duration
          character: 'stewie',
          text: turn.stewie
        });

        currentTime += (stewieData.data.duration || 2) + GAP_BETWEEN_LINES;

        // Generate Peter's line
        const peterResponse = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: turn.peter,
            speaker: "5ccc6825-3a96-11ee-ab0d-8cec4b691ee9",
            emotion: 'neutral'
          }),
        });

        if (!peterResponse.ok) throw new Error('Failed to generate Peter speech');
        const peterData = await peterResponse.json();

        parts.push({
          url: peterData.data.oss_url,
          startTime: currentTime,
          duration: peterData.data.duration || 2,
          character: 'peter',
          text: turn.peter
        });

        currentTime += (peterData.data.duration || 2) + GAP_BETWEEN_LINES;
      }

      setAudioParts(parts);
    } catch (err) {
      console.error('Failed to generate full conversation:', err);
      setError('Failed to generate audio conversation');
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  const playFullConversation = async () => {
    for (const part of audioParts) {
      const audio = new Audio(part.url);
      await new Promise((resolve) => {
        audio.onended = resolve;
        audio.play();
      });
      // Add a small gap between lines
      await new Promise(resolve => setTimeout(resolve, 200));
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
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-blue-600">Conversation</h2>
            <button
              onClick={audioParts.length ? playFullConversation : generateFullConversation}
              disabled={isGeneratingAudio}
              className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:bg-green-300"
            >
              {isGeneratingAudio ? 'Generating Audio...' : 
               audioParts.length ? 'Play Full Conversation' : 'Generate Full Audio'}
            </button>
          </div>

          {conversation.map((turn, index) => (
            <div key={index} className="space-y-2">
              <div className="bg-blue-100 p-4 rounded-lg">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-blue-800">Stewie:</p>
                  {audioParts.length > 0 && (
                    <span className="text-sm text-gray-500">
                      {audioParts[index * 2].startTime.toFixed(1)}s
                    </span>
                  )}
                </div>
                <p className="text-blue-700">{turn.stewie}</p>
              </div>
              <div className="bg-gray-200 p-4 rounded-lg">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-gray-800">Peter:</p>
                  {audioParts.length > 0 && (
                    <span className="text-sm text-gray-500">
                      {audioParts[index * 2 + 1].startTime.toFixed(1)}s
                    </span>
                  )}
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
