"use client";
import { useState } from 'react';

interface ConversationTurn {
  stewie: string;
  peter: string;
}

interface VideoState {
  topic: string;
  knowledge: string;
  conversation: ConversationTurn[];
  isGeneratingConversation: boolean;
  isGeneratingVideo: boolean;
  videoProgress: string;
  videoUrl: string | null;
  error: string;
  uploadedImages: File[];
}

export default function HomePage() {
  const [video1, setVideo1] = useState<VideoState>({
    topic: '',
    knowledge: '',
    conversation: [],
    isGeneratingConversation: false,
    isGeneratingVideo: false,
    videoProgress: '',
    videoUrl: null,
    error: '',
    uploadedImages: []
  });

  const [video2, setVideo2] = useState<VideoState>({
    topic: '',
    knowledge: '',
    conversation: [],
    isGeneratingConversation: false,
    isGeneratingVideo: false,
    videoProgress: '',
    videoUrl: null,
    error: '',
    uploadedImages: []
  });

  const updateVideoState = (videoNum: 1 | 2, updates: Partial<VideoState>) => {
    if (videoNum === 1) {
      setVideo1(prev => ({ ...prev, ...updates }));
    } else {
      setVideo2(prev => ({ ...prev, ...updates }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Reset both videos
    const resetState = {
      conversation: [],
      videoUrl: null,
      videoProgress: '',
      error: ''
    };
    
    setVideo1(prev => ({ ...prev, ...resetState }));
    setVideo2(prev => ({ ...prev, ...resetState }));
    
    // Start both video generations simultaneously
    const promise1 = generateVideoComplete(1);
    const promise2 = generateVideoComplete(2);
    
    // Wait for both to complete (or fail)
    try {
      await Promise.allSettled([promise1, promise2]);
    } catch (err) {
      console.error('Error in parallel video generation:', err);
    }
  };

  const generateVideoComplete = async (videoNum: 1 | 2) => {
    const videoState = videoNum === 1 ? video1 : video2;
    
    if (!videoState.topic.trim()) {
      updateVideoState(videoNum, { error: 'Please enter a topic' });
      return;
    }

    // Step 1: Generate conversation
    updateVideoState(videoNum, { isGeneratingConversation: true, error: '' });
    
    try {
      console.log(`Generating conversation for video ${videoNum}, topic:`, videoState.topic);
      
      // Process uploaded images
      const mediaFiles = [];
      for (const file of videoState.uploadedImages) {
        const base64 = await fileToBase64(file);
        const fileType = file.type.startsWith('video/') ? 'video' : 'image';
        mediaFiles.push({
          data: base64.split(',')[1], // Remove data:image/... prefix
          mimeType: file.type,
          filename: file.name,
          type: fileType
        });
      }
      
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          topic: videoState.topic, 
          knowledge: videoState.knowledge.trim() || undefined,
          mediaFiles: mediaFiles.length > 0 ? mediaFiles : undefined
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate conversation');
      }

      const conversationData = await response.json();
      console.log(`Generated conversation for video ${videoNum}:`, conversationData);
      updateVideoState(videoNum, { 
        conversation: conversationData,
        isGeneratingConversation: false 
      });
      
      // Step 2: Start video generation
      await generateVideo(videoNum, conversationData, mediaFiles);
      
    } catch (err) {
      console.error(`Error generating video ${videoNum}:`, err);
      updateVideoState(videoNum, { 
        error: 'Failed to generate conversation. Please try again.',
        isGeneratingConversation: false 
      });
    }
  };

  const generateVideo = async (videoNum: 1 | 2, conversationData: ConversationTurn[], mediaFiles: any[] = []) => {
    updateVideoState(videoNum, { 
      isGeneratingVideo: true,
      videoProgress: 'Initializing video generation...' 
    });
    
    try {
      console.log(`Starting video generation for video ${videoNum}...`);
      updateVideoState(videoNum, { videoProgress: 'Generating audio for conversation...' });
      
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
          body: JSON.stringify({ 
            conversation: conversationData,
            mediaFiles: mediaFiles.length > 0 ? mediaFiles : undefined
          }),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
      } catch (fetchError) {
        console.error(`Fetch error for video ${videoNum}:`, fetchError);
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

      updateVideoState(videoNum, { videoProgress: 'Downloading generated video...' });
      
      // Get the video as a blob
      let videoBlob;
      try {
        console.log(`Starting to download video blob for video ${videoNum}...`);
        videoBlob = await response.blob();
        console.log(`Video ${videoNum} blob size:`, videoBlob.size / (1024 * 1024), 'MB');
      } catch (blobError) {
        console.error(`Error reading response as blob for video ${videoNum}:`, blobError);
        throw new Error('Failed to read video response');
      }
      
      const url = URL.createObjectURL(videoBlob);
      
      updateVideoState(videoNum, { 
        videoUrl: url,
        videoProgress: 'Video generation completed!' 
      });
      
      console.log(`Video ${videoNum} generated successfully`);
      
    } catch (err) {
      console.error(`Failed to generate video ${videoNum}:`, err);
      updateVideoState(videoNum, { 
        error: err instanceof Error ? err.message : 'Failed to generate video',
        videoProgress: '' 
      });
    } finally {
      updateVideoState(videoNum, { isGeneratingVideo: false });
    }
  };

  const downloadVideo = (videoNum: 1 | 2) => {
    const videoState = videoNum === 1 ? video1 : video2;
    if (!videoState.videoUrl) return;
    
    const a = document.createElement('a');
    a.href = videoState.videoUrl;
    a.download = `peter-stewie-${videoState.topic.replace(/\s+/g, '-').toLowerCase()}-video${videoNum}-${Date.now()}.mp4`;
    a.click();
  };

  const retryGeneration = (videoNum: 1 | 2) => {
    updateVideoState(videoNum, {
      error: '',
      videoUrl: null,
      videoProgress: '',
      conversation: [],
      uploadedImages: []
    });
  };

  const resetAll = () => {
    const resetState = {
      topic: '',
      knowledge: '',
      conversation: [],
      videoUrl: null,
      videoProgress: '',
      error: '',
      isGeneratingConversation: false,
      isGeneratingVideo: false,
      uploadedImages: []
    };
    setVideo1(resetState);
    setVideo2(resetState);
  };

  const isAnyGenerating = video1.isGeneratingConversation || video1.isGeneratingVideo || 
                          video2.isGeneratingConversation || video2.isGeneratingVideo;

  // Helper function to convert file to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  // Handle image/video upload
  const handleImageUpload = (videoNum: 1 | 2, files: FileList | null) => {
    if (!files) return;
    
    const newMedia = Array.from(files).filter(file => {
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');
      const sizeLimit = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024; // 50MB for videos, 10MB for images
      
      if (!isImage && !isVideo) {
        console.warn(`Skipping unsupported file type: ${file.name} (${file.type})`);
        return false;
      }
      
      if (file.size > sizeLimit) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        const limitMB = isVideo ? 50 : 10;
        console.warn(`Skipping oversized file: ${file.name} (${sizeMB}MB > ${limitMB}MB limit)`);
        updateVideoState(videoNum, { 
          error: `File "${file.name}" is too large (${sizeMB}MB). ${isVideo ? 'Videos' : 'Images'} must be under ${limitMB}MB.`
        });
        return false;
      }
      
      return true;
    });
    
    if (newMedia.length === 0) return;
    
    const videoState = videoNum === 1 ? video1 : video2;
    const updatedMedia = [...videoState.uploadedImages, ...newMedia].slice(0, 5); // Max 5 files
    
    // Clear any previous upload errors
    if (videoState.error && videoState.error.includes('too large')) {
      updateVideoState(videoNum, { uploadedImages: updatedMedia, error: '' });
    } else {
      updateVideoState(videoNum, { uploadedImages: updatedMedia });
    }
  };

  // Remove uploaded image
  const removeImage = (videoNum: 1 | 2, index: number) => {
    const videoState = videoNum === 1 ? video1 : video2;
    const updatedImages = videoState.uploadedImages.filter((_, i) => i !== index);
    updateVideoState(videoNum, { uploadedImages: updatedImages });
  };

  const VideoSection = ({ videoNum, videoState }: { videoNum: 1 | 2, videoState: VideoState }) => (
    <div className="w-full">
      <h2 className="text-2xl font-bold mb-4 text-blue-400">Video {videoNum}</h2>
      
      {/* Input Form */}
      <div className="space-y-4 mb-6">
        <input
          type="text"
          value={videoState.topic}
          onChange={(e) => updateVideoState(videoNum, { topic: e.target.value })}
          placeholder={`Enter topic for video ${videoNum} (e.g. 'Cuda', 'Bitcoin', 'Pizza')...`}
          className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
          disabled={isAnyGenerating}
        />
        
        {/* Knowledge Section */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-300">
            Knowledge Context (Optional)
          </label>
          <textarea
            value={videoState.knowledge}
            onChange={(e) => updateVideoState(videoNum, { knowledge: e.target.value })}
            placeholder="Paste any additional context for this video..."
            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-vertical"
            rows={3}
            disabled={isAnyGenerating}
          />
        </div>

        {/* Image/Video Upload Section */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-300">
            Upload Images/Videos (Optional)
          </label>
          <input
            type="file"
            accept="image/*,video/*"
            multiple
            onChange={(e) => handleImageUpload(videoNum, e.target.files)}
            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            disabled={isAnyGenerating}
          />
          <p className="text-xs text-gray-500">
            Upload up to 5 images/videos (max 50MB each). The AI will automatically place them at the right moments.
          </p>
          
          {/* Media Previews */}
          {videoState.uploadedImages.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
              {videoState.uploadedImages.map((file, index) => (
                <div key={index} className="relative">
                  {file.type.startsWith('image/') ? (
                    <img
                      src={URL.createObjectURL(file)}
                      alt={`Upload ${index + 1}`}
                      className="w-full h-20 object-cover rounded-lg border border-gray-300"
                    />
                  ) : file.type.startsWith('video/') ? (
                    <video
                      className="w-full h-20 object-cover rounded-lg border border-gray-300"
                      muted
                    >
                      <source src={URL.createObjectURL(file)} type={file.type} />
                      Your browser does not support the video tag.
                    </video>
                  ) : (
                    <div className="w-full h-20 bg-gray-200 rounded-lg border border-gray-300 flex items-center justify-center">
                      <span className="text-xs text-gray-500">Unsupported</span>
                    </div>
                  )}
                  <button
                    onClick={() => removeImage(videoNum, index)}
                    className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs hover:bg-red-600"
                    disabled={isAnyGenerating}
                  >
                    ×
                  </button>
                  <p className="text-xs text-gray-400 mt-1 truncate">{file.name}</p>
                  <p className="text-xs text-blue-400">{file.type.startsWith('video/') ? 'Video' : 'Image'}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Error Message */}
      {videoState.error && (
        <div className="mb-6">
          <div className="bg-red-900 border border-red-600 text-red-100 px-4 py-3 rounded-lg">
            <h3 className="font-bold mb-2">Error</h3>
            <p>{videoState.error}</p>
            <button
              onClick={() => retryGeneration(videoNum)}
              className="mt-3 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      )}

      {/* Progress Section */}
      {(videoState.isGeneratingConversation || videoState.isGeneratingVideo) && (
        <div className="mb-6">
          <div className="bg-gray-800 border border-gray-600 rounded-lg p-6">
            <h3 className="text-white text-lg mb-4">
              {videoState.isGeneratingConversation ? '🤖 Generating Conversation...' : '🎬 Creating Video...'}
            </h3>
            
            {/* Progress Steps */}
            <div className="space-y-3">
              <div className="flex items-center space-x-3">
                <div className={`w-4 h-4 rounded-full ${
                  videoState.conversation.length > 0 ? 'bg-green-500' : 
                  videoState.isGeneratingConversation ? 'bg-blue-500 animate-pulse' : 'bg-gray-500'
                }`}></div>
                <span className={`${
                  videoState.conversation.length > 0 ? 'text-green-400' : 
                  videoState.isGeneratingConversation ? 'text-blue-400' : 'text-gray-400'
                }`}>
                  Generate conversation with Gemini AI
                </span>
              </div>
              
              <div className="flex items-center space-x-3">
                <div className={`w-4 h-4 rounded-full ${
                  videoState.videoUrl ? 'bg-green-500' : 
                  videoState.isGeneratingVideo ? 'bg-blue-500 animate-pulse' : 'bg-gray-500'
                }`}></div>
                <span className={`${
                  videoState.videoUrl ? 'text-green-400' : 
                  videoState.isGeneratingVideo ? 'text-blue-400' : 'text-gray-400'
                }`}>
                  Create video with RVC voices, Whisper timing & subtitles
                </span>
              </div>
            </div>
            
            {videoState.videoProgress && (
              <div className="mt-4 text-gray-300 text-sm bg-gray-700 p-3 rounded">
                {videoState.videoProgress}
              </div>
            )}
            
            {/* Loading Animation */}
            {(videoState.isGeneratingConversation || videoState.isGeneratingVideo) && (
              <div className="mt-4 flex justify-center">
                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Conversation Preview */}
      {videoState.conversation.length > 0 && !videoState.isGeneratingVideo && !videoState.videoUrl && (
        <div className="mb-6">
          <div className="bg-gray-800 border border-gray-600 rounded-lg p-6">
            <h3 className="text-white text-lg mb-4">Generated Conversation</h3>
            <div className="space-y-3 max-h-40 overflow-y-auto">
              {videoState.conversation.map((turn, index) => (
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
      {videoState.videoUrl && (
        <div className="mb-6">
          <div className="bg-gray-800 border border-gray-600 rounded-lg p-6">
            <h3 className="text-white text-lg mb-4">✅ Video {videoNum} is Ready!</h3>
            
            {/* Video Player */}
            <div className="mb-4 flex justify-center">
              <video
                controls
                className="max-w-full max-h-64 rounded-lg"
                style={{ maxWidth: '280px' }}
              >
                <source src={videoState.videoUrl} type="video/mp4" />
                Your browser does not support the video tag.
              </video>
            </div>
            
            {/* Download Button */}
            <div className="flex justify-center">
              <button
                onClick={() => downloadVideo(videoNum)}
                className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2"
              >
                <span>📥</span>
                <span>Download Video {videoNum}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col items-center p-8 bg-black">
      <h1 className="text-4xl font-bold mb-4 text-blue-600">GoOnly - Dual AI Video Generator</h1>
      <p className="text-gray-300 text-center mb-8 max-w-3xl">
        Enter two different topics and watch Peter and Stewie discuss them in parallel AI-generated videos with perfect timing and subtitles.
      </p>
      
      {/* Generate Both Videos Button */}
      <form onSubmit={handleSubmit} className="w-full max-w-6xl mb-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-6">
          <VideoSection videoNum={1} videoState={video1} />
          <VideoSection videoNum={2} videoState={video2} />
        </div>
        
        <div className="flex justify-center">
          <button
            type="submit"
            disabled={isAnyGenerating || (!video1.topic.trim() && !video2.topic.trim())}
            className="px-8 py-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-blue-300 text-lg font-semibold"
          >
            {isAnyGenerating ? 'Generating Videos...' : 'Generate Both Videos Simultaneously'}
          </button>
        </div>
      </form>

      {/* Create New Videos */}
      {(video1.videoUrl || video2.videoUrl) && (
        <div className="w-full max-w-md">
          <button
            onClick={resetAll}
            className="w-full px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            Create New Videos
          </button>
        </div>
      )}

      {/* Overall Progress Info */}
      {isAnyGenerating && (
        <div className="mt-8 text-gray-400 text-center">
          <p>🚀 Videos are being generated in parallel for faster processing!</p>
          <p className="text-sm">Powered by: Gemini AI, RVC Voice Cloning, Whisper Timing, FFmpeg</p>
        </div>
      )}
    </div>
  );
}
