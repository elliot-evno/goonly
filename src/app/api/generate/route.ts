import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { env } from "../env";

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY || "");

interface ConversationRequest {
  topic: string;
}

export async function POST(request: Request) {
  try {
    const data: ConversationRequest = await request.json();
    
    const prompt = `
      Create an educational conversation between Stewie (a highly intelligent baby) and Peter (his simple-minded father) about the following topic: ${data.topic}
      
      The conversation should be informative but entertaining, with Stewie asking intelligent questions and Peter explaining things in his characteristic simple way.
      
      Format the response as a JSON array of conversation turns, where each turn has "stewie" and "peter" keys.
      
      Example format:
      [
        {"stewie": "How does this work?", "peter": "Well, it's like this..."},
        {"stewie": "But what about...?", "peter": "Oh, that's easy..."}
      ]
      Avoid making family guy references, and try to just make so that Peter gives a good answer to Stewie's question using funny examples. 
     Both Stewie and Peter should use simple terms and words. Their sentences should be brief and stewie should start with a question on the topic.
     It should almost be as if Peter is Stewie's teacher.
      Make it 3-4 turns long.
    `;

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();
    
    text = text.replace(/```json\n/g, '').replace(/```/g, '').trim();
    
    try {
      const conversation = JSON.parse(text);
      return NextResponse.json(conversation);
    } catch (jsonError) {
      console.error("JSON parsing error:", text);
      return NextResponse.json(
        { error: "Failed to parse AI response as JSON" },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error("Conversation generation error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: error.status || 500 }
    );
  }
}