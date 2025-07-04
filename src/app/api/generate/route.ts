import { GoogleGenerativeAI, Part } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { env } from "../env";

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY || "");

interface MediaFile {
  data: string; // base64 encoded
  mimeType: string;
  filename: string;
  type: 'image' | 'video';
}

interface ConversationRequest {
  topic: string;
  knowledge?: string;
  mediaFiles?: MediaFile[];
}

export async function POST(request: Request) {
  try {
    const data: ConversationRequest = await request.json();
    
    const knowledgeSection = data.knowledge ? `
      
      Additional Knowledge Context:
      ${data.knowledge}
      
      Use this knowledge context to inform the conversation but keep the explanations simple and accessible.
    ` : '';

    const mediaSection = data.mediaFiles && data.mediaFiles.length > 0 ? `
      
      IMPORTANT: I have provided ${data.mediaFiles.length} media file(s) (images and/or videos).
      You MUST include imageOverlays data for each media file showing when it should appear in the video.
      
      For each uploaded media file:
      1. Look at what the image/video shows
      2. Peter should NEVER mention or reference the media files in his dialogue
      3. The media should appear automatically at relevant moments through imageOverlays timing
      4. Use the exact filename provided
      5. Use "triggerWord" to specify which word should trigger the media appearance
      6. For videos: do NOT specify duration (they will play their full length)
      7. For images: specify duration (usually 2-5 seconds)
      
      Available media files: ${data.mediaFiles.map(f => `${f.filename} (${f.type})`).join(', ')}
      
      REQUIRED: Include imageOverlays array in at least one conversation turn.
    ` : '';

    const prompt = `
      Create an educational conversation between Stewie (a highly intelligent baby) and Peter (his simple-minded father) about the following topic: ${data.topic}
      ${knowledgeSection}
      ${mediaSection}
      The conversation should be informative but entertaining, with Stewie asking intelligent questions and Peter explaining things in his characteristic simple way.
      
      IMPORTANT: Peter and Stewie should talk to each other like normal people. Avoid any references to:
      - Stewie being a baby
      - Peter being simple-minded or an imbecile
      - Any typical Family Guy insults or put-downs
      They should interact respectfully while still being funny and engaging.
      
      Format the response as a JSON array of conversation turns, where each turn has "stewie" and "peter" keys.
      ${data.mediaFiles && data.mediaFiles.length > 0 ? 
        'MANDATORY: Since media files were uploaded, you MUST include "imageOverlays" array in the conversation turns. Peter should never mention the media in his dialogue - they will appear automatically through the overlay timing.' : 
        'If you reference uploaded media in the conversation, also include an "imageOverlays" array with timing information.'
      }
      
      ${data.mediaFiles && data.mediaFiles.length > 0 ? 
        `Example format (REQUIRED when media files are uploaded):
        [
          {
            "stewie": "How does this work?", 
            "peter": "Well, it works by making things better and easier to use for everyone...",
            "imageOverlays": [
              {
                "filename": "${data.mediaFiles[0].filename}",
                "triggerWord": "easier",
                "duration": ${data.mediaFiles[0].type === 'video' ? 'null' : '4.0'},
                "description": "Shows relevant ${data.mediaFiles[0].type} when Peter says 'easier'"
              }
            ]
          },
          {"stewie": "But what about...?", "peter": "Oh, that's easy..."}
        ]` :
        `Example format:
        [
          {
            "stewie": "How does this work?", 
            "peter": "Well, it's like this...",
            "imageOverlays": [
              {
                "filename": "example.jpg",
                "triggerWord": "this",
                "duration": 3.0,
                "description": "Shows when Peter says the word 'this'"
              }
            ]
          },
          {"stewie": "But what about...?", "peter": "Oh, that's easy..."}
        ]`
      }
      
      For imageOverlays:
      - triggerWord: the exact word from Peter or Stewie's dialogue that should trigger the media to appear
      - duration: how long in seconds the IMAGE should be visible (2-5 seconds). For VIDEOS, set this to null or omit it entirely
      - filename: exact filename of the uploaded media file to show
      - description: brief explanation of why this media is shown at this word
      
      IMPORTANT: 
      - Peter should never say things like "look at this image", "watch this video", "as you can see here", or reference media in any way in his dialogue.
      - The triggerWord must be an exact word that appears in either Peter or Stewie's dialogue
      - Choose trigger words that are relevant to when the media should appear
      - For videos: they will play their full length automatically, so don't specify duration
      - For images: always specify a duration between 2-5 seconds
      
      Avoid making family guy references, and try to just make so that Peter gives a good answer to Stewie's question using funny examples. 
     Both Stewie and Peter should use simple terms and words. Their sentences should be brief and stewie should start with a question on the topic.
     Do not use special characters or emojis. Because using "*" for example will make the voice say "asterisk", we do not want that.
     It should almost be as if Peter is Stewie's teacher, with both characters treating each other with respect.
      Make it 3-4 turns long.
    `;

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    // Prepare content array with prompt and media files
    const content: (string | Part)[] = [prompt];
    
    // Add media files to the content
    if (data.mediaFiles && data.mediaFiles.length > 0) {
      for (const mediaFile of data.mediaFiles) {
        if (mediaFile.type === 'image') {
          content.push({
            inlineData: {
              data: mediaFile.data,
              mimeType: mediaFile.mimeType
            }
          });
        }
        // Note: Gemini doesn't support video input yet, but we include the filename for AI awareness
      }
    }
    
    const result = await model.generateContent(content);
    const response = result.response;
    let text = response.text();
    
    // Log raw AI response to check for image overlay data
    
    // Clean up the text more thoroughly
    text = text.replace(/```json\n?/g, '').replace(/```/g, '').trim();
    
    // Remove any leading/trailing non-JSON content
    const jsonStart = text.indexOf('[');
    const jsonEnd = text.lastIndexOf(']');
    
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      text = text.substring(jsonStart, jsonEnd + 1);
    }
    
    try {
      const conversation = JSON.parse(text);
      
      // Validate that it's an array of conversation objects
      if (!Array.isArray(conversation)) {
        throw new Error("Response is not an array");
      }
      
      for (const turn of conversation) {
        if (!turn.stewie || !turn.peter) {
          throw new Error("Invalid conversation format");
        }
      }
      
      // Check if imageOverlays are included when media files were provided
      if (data.mediaFiles && data.mediaFiles.length > 0) {
        const hasImageOverlays = conversation.some(turn => turn.imageOverlays && turn.imageOverlays.length > 0);
        if (!hasImageOverlays) {
          console.log('⚠️ WARNING: Media files were uploaded but no imageOverlays found in conversation');
        }
      }
      
      return NextResponse.json(conversation);
    } catch (parseError) {
      console.error("JSON parsing error:", parseError);
      console.error("Raw AI response:", text);
      return NextResponse.json(
        { error: "Failed to parse AI response as JSON", rawResponse: text.substring(0, 200) + "..." },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Conversation generation error:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    const errorStatus = error instanceof Error && 'status' in error ? (error as { status: number }).status : 500;
    return NextResponse.json(
      { error: errorMessage },
      { status: errorStatus }
    );
  }
}