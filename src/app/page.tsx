"use client";
import { useState } from 'react';

interface ConversationTurn {
  stewie: string;
  peter: string;
}

export default function HomePage() {
  const [topic, setTopic] = useState('');
  const [knowledge, setKnowledge] = useState('');
  const [conversation, setConversation] = useState<ConversationTurn[]>([]);
  const [isGeneratingConversation, setIsGeneratingConversation] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [videoProgress, setVideoProgress] = useState('');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setConversation([]);
    setVideoUrl(null);
    setVideoProgress('');
    
    // Step 1: Generate conversation
    setIsGeneratingConversation(true);
    
    try {
      console.log('Generating conversation for topic:', topic);
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ topic, knowledge: knowledge.trim() || undefined }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate conversation');
      }

      const conversationData = await response.json();
      console.log('Generated conversation:', conversationData);
      setConversation(conversationData);
      
      // Step 2: Automatically start video generation
      setIsGeneratingConversation(false);
      await generateVideo(conversationData);
      
    } catch (err) {
      console.error('Error:', err);
      setError('Failed to generate conversation. Please try again.');
      setIsGeneratingConversation(false);
    }
  };

  const generateVideo = async (conversationData: ConversationTurn[]) => {
    setIsGeneratingVideo(true);
    setVideoProgress('Initializing video generation...');
    
    try {
      console.log('Starting video generation...');
      setVideoProgress('Generating audio for conversation...');
      
      let response;
      try {
        // Create abort controller with a very long timeout (10 minutes)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 minutes
        const url = process.env.NODE_ENV === 'development' 
        ? 'http://localhost:8000/' 
        : 'https://goonly.norrevik.ai/';

        response = await fetch(url + 'video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversation: conversationData }),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
      } catch (fetchError) {
        console.error('Fetch error:', fetchError);
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          throw new Error('Request timed out after 10 minutes');
        }
        throw new Error(`Network error: ${fetchError instanceof Error ? fetchError.message : 'Unknown fetch error'}`);
      }

      if (!response.ok) {
        let errorMessage = 'Failed to generate video';
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorData.error || errorMessage;
        } catch {
          // If response is not JSON, try to get text
          try {
            errorMessage = await response.text();
          } catch {
            errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          }
        }
        throw new Error(errorMessage);
      }

      setVideoProgress('Downloading generated video...');
      
      // Get the video as a blob
      let videoBlob;
      try {
        console.log('Starting to download video blob...');
        videoBlob = await response.blob();
        console.log('Video blob size:', videoBlob.size / (1024 * 1024), 'MB');
      } catch (blobError) {
        console.error('Error reading response as blob:', blobError);
        throw new Error('Failed to read video response');
      }
      
      const url = URL.createObjectURL(videoBlob);
      
      setVideoUrl(url);
      setVideoProgress('Video generation completed!');
      
      console.log('Video generated successfully');
      
    } catch (err) {
      console.error('Failed to generate video:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate video');
      setVideoProgress('');
    } finally {
      setIsGeneratingVideo(false);
    }
  };

  const downloadVideo = () => {
    if (!videoUrl) return;
    
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `peter-stewie-${topic.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.mp4`;
    a.click();
  };

  const retryGeneration = () => {
    setError('');
    setVideoUrl(null);
    setVideoProgress('');
    setConversation([]);
    // This will allow user to try again with the same or different topic
  };

  return (
    <div className="min-h-screen flex flex-col items-center p-8 bg-black">
      <h1 className="text-4xl font-bold mb-8 text-blue-600">GoOnly - AI Video Generator</h1>
      <p className="text-gray-300 text-center mb-8 max-w-2xl">
        Enter any topic and watch Peter and Stewie discuss it in an AI-generated video with perfect timing and subtitles.
      </p>
      
      {/* Input Form */}
      <form onSubmit={handleSubmit} className="w-full max-w-2xl mb-8">
        <div className="space-y-4">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Enter a topic (e.g. 'Cuda', 'Bitcoin', 'Pizza')..."
            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
            disabled={isGeneratingConversation || isGeneratingVideo}
          />
          
          {/* Knowledge Section */}
          <div className="space-y-2">
            <label htmlFor="knowledge" className="block text-sm font-medium text-gray-300">
              Knowledge Context (Optional)
            </label>
            <textarea
              id="knowledge"
              value={knowledge}
              onChange={(e) => setKnowledge(e.target.value)}
              placeholder="Paste any additional context, articles, or information you want the AI to reference when creating the conversation..."
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-vertical"
              rows={4}
              disabled={isGeneratingConversation || isGeneratingVideo}
            />
            <p className="text-xs text-gray-400">
              This content will help inform the conversation but explanations will remain simple and accessible.
            </p>
          </div>
          
          <button
            type="submit"
            disabled={isGeneratingConversation || isGeneratingVideo}
            className="w-full px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-blue-300"
          >
            {isGeneratingConversation ? 'Generating Conversation...' : 
             isGeneratingVideo ? 'Creating Video...' : 
             'Generate Video'}
          </button>
        </div>
      </form>

      {/* Error Message */}
      {error && (
        <div className="w-full max-w-2xl mb-6">
          <div className="bg-red-900 border border-red-600 text-red-100 px-4 py-3 rounded-lg">
            <h3 className="font-bold mb-2">Error</h3>
            <p>{error}</p>
            <button
              onClick={retryGeneration}
              className="mt-3 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      )}

      {/* Progress Section */}
      {(isGeneratingConversation || isGeneratingVideo) && (
        <div className="w-full max-w-2xl mb-8">
          <div className="bg-gray-800 border border-gray-600 rounded-lg p-6">
            <h3 className="text-white text-lg mb-4">
              {isGeneratingConversation ? '🤖 Generating Conversation...' : '🎬 Creating Video...'}
            </h3>
            
            {/* Progress Steps */}
            <div className="space-y-3">
              <div className="flex items-center space-x-3">
                <div className={`w-4 h-4 rounded-full ${
                  conversation.length > 0 ? 'bg-green-500' : 
                  isGeneratingConversation ? 'bg-blue-500 animate-pulse' : 'bg-gray-500'
                }`}></div>
                <span className={`${
                  conversation.length > 0 ? 'text-green-400' : 
                  isGeneratingConversation ? 'text-blue-400' : 'text-gray-400'
                }`}>
                  Generate conversation with Gemini AI
                </span>
              </div>
              
              <div className="flex items-center space-x-3">
                <div className={`w-4 h-4 rounded-full ${
                  videoUrl ? 'bg-green-500' : 
                  isGeneratingVideo ? 'bg-blue-500 animate-pulse' : 'bg-gray-500'
                }`}></div>
                <span className={`${
                  videoUrl ? 'text-green-400' : 
                  isGeneratingVideo ? 'text-blue-400' : 'text-gray-400'
                }`}>
                  Create video with RVC voices, Whisper timing & subtitles
                </span>
              </div>
            </div>
            
            {videoProgress && (
              <div className="mt-4 text-gray-300 text-sm bg-gray-700 p-3 rounded">
                {videoProgress}
              </div>
            )}
            
            {/* Loading Animation */}
            {(isGeneratingConversation || isGeneratingVideo) && (
              <div className="mt-4 flex justify-center">
                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Conversation Preview */}
      {conversation.length > 0 && !isGeneratingVideo && !videoUrl && (
        <div className="w-full max-w-2xl mb-8">
          <div className="bg-gray-800 border border-gray-600 rounded-lg p-6">
            <h3 className="text-white text-lg mb-4">Generated Conversation</h3>
            <div className="space-y-3 max-h-60 overflow-y-auto">
              {conversation.map((turn, index) => (
                <div key={index} className="space-y-2">
                  <div className="bg-blue-900 p-3 rounded text-sm">
                    <span className="font-bold text-blue-300">Stewie:</span>
                    <span className="text-blue-100 ml-2">{turn.stewie}</span>
                  </div>
                  <div className="bg-gray-700 p-3 rounded text-sm">
                    <span className="font-bold text-gray-300">Peter:</span>
                    <span className="text-gray-100 ml-2">{turn.peter}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Video Player Section */}
      {videoUrl && (
        <div className="w-full max-w-2xl mb-8">
          <div className="bg-gray-800 border border-gray-600 rounded-lg p-6">
            <h3 className="text-white text-lg mb-4">✅ Your Video is Ready!</h3>
            
            {/* Video Player */}
            <div className="mb-4 flex justify-center">
              <video
                controls
                className="max-w-full max-h-96 rounded-lg"
                style={{ maxWidth: '300px' }}
              >
                <source src={videoUrl} type="video/mp4" />
                Your browser does not support the video tag.
              </video>
            </div>
            
            {/* Download Button */}
            <div className="flex justify-center">
              <button
                onClick={downloadVideo}
                className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2"
              >
                <span>📥</span>
                <span>Download Video</span>
              </button>
            </div>
            
            {/* Video Info */}
            <div className="mt-4 text-gray-400 text-sm text-center">
              <p>Video includes: AI-generated voices, character animations, word-by-word subtitles</p>
              <p>Powered by: Gemini AI, RVC Voice Cloning, Whisper Timing, FFmpeg</p>
            </div>
          </div>
        </div>
      )}

      {/* Create Another Video */}
      {videoUrl && (
        <div className="w-full max-w-md">
          <button
            onClick={() => {
              setTopic('');
              setKnowledge('');
              setConversation([]);
              setVideoUrl(null);
              setVideoProgress('');
              setError('');
            }}
            className="w-full px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            Create Another Video
          </button>
        </div>
      )}
    </div>
  );
}
