import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import path from 'path';
import fs from 'fs';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

interface MediaAnalysis {
  description: string;
  tags: string[];
  suggestedTimestamp?: number; // Where in video this should appear (seconds)
  type: 'image' | 'video';
  filename: string;
  size: number;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    const context = formData.get('context') as string || '';
    
    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    // Create uploads directory
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const mediaAnalyses: MediaAnalysis[] = [];

    for (const file of files) {
      // Validate file type
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');
      
      if (!isImage && !isVideo) {
        continue; // Skip non-media files
      }

      // Save file
      const filename = `${Date.now()}_${file.name}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      await fs.promises.writeFile(path.join(uploadsDir, filename), buffer);

      // Analyze with AI vision
      let analysis: MediaAnalysis;
      
      if (isImage) {
        analysis = await analyzeImage(buffer, file.type, filename, file.size, context);
      } else {
        analysis = await analyzeVideo(filename, file.size, context);
      }

      mediaAnalyses.push(analysis);
    }

    return NextResponse.json({ 
      success: true, 
      analyses: mediaAnalyses,
      message: `Successfully processed ${mediaAnalyses.length} media files`
    });

  } catch (error) {
    console.error('Media upload error:', error);
    return NextResponse.json({ 
      error: 'Failed to process media',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

async function analyzeImage(
  buffer: Buffer, 
  mimeType: string, 
  filename: string, 
  size: number,
  context: string
): Promise<MediaAnalysis> {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `Analyze this image and provide:
1. A detailed description of what you see
2. Relevant tags/keywords (max 10)
3. If this image relates to the context "${context}", suggest when in a conversation it might be most relevant (as a percentage 0-100, where 0 is beginning and 100 is end)

Format your response as JSON:
{
  "description": "detailed description",
  "tags": ["tag1", "tag2", ...],
  "relevancePercentage": 50
}`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: buffer.toString('base64'),
          mimeType: mimeType
        }
      }
    ]);

    const response = result.response.text();
    const parsed = JSON.parse(response.replace(/```json\n?|\n?```/g, ''));

    return {
      description: parsed.description,
      tags: parsed.tags,
      suggestedTimestamp: parsed.relevancePercentage,
      type: 'image',
      filename,
      size
    };

  } catch (error) {
    console.error('Image analysis error:', error);
    return {
      description: 'Image analysis failed',
      tags: ['image', 'unanalyzed'],
      type: 'image',
      filename,
      size
    };
  }
}

async function analyzeVideo(
  filename: string, 
  size: number,
  context: string
): Promise<MediaAnalysis> {
  try {
    // For video analysis, we could extract frames and analyze them
    // For now, we'll do basic analysis based on filename and size
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `Based on the video filename "${filename}" and context "${context}", provide:
1. A description of what this video might contain
2. Relevant tags/keywords (max 10)  
3. Suggest when in a conversation this video might be most relevant (as a percentage 0-100)

Format as JSON:
{
  "description": "description based on filename and context",
  "tags": ["tag1", "tag2", ...],
  "relevancePercentage": 50
}`;

    const result = await model.generateContent(prompt);
    const response = result.response.text();
    const parsed = JSON.parse(response.replace(/```json\n?|\n?```/g, ''));

    return {
      description: parsed.description,
      tags: parsed.tags,
      suggestedTimestamp: parsed.relevancePercentage,
      type: 'video',
      filename,
      size
    };

  } catch (error) {
    console.error('Video analysis error:', error);
    return {
      description: 'Video analysis failed',
      tags: ['video', 'unanalyzed'],
      type: 'video',
      filename,
      size
    };
  }
}

export async function GET() {
  try {
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    
    if (!fs.existsSync(uploadsDir)) {
      return NextResponse.json({ files: [] });
    }

    const files = await fs.promises.readdir(uploadsDir);
    const mediaFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.gif', '.mp4', '.mov', '.avi', '.webm'].includes(ext);
    });

    return NextResponse.json({ 
      files: mediaFiles.map(file => ({
        filename: file,
        url: `/uploads/${file}`,
        uploadedAt: fs.statSync(path.join(uploadsDir, file)).mtime
      }))
    });

  } catch (error) {
    console.error('Get media files error:', error);
    return NextResponse.json({ error: 'Failed to get media files' }, { status: 500 });
  }
}