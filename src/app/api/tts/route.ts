import { NextResponse } from "next/server";
import { env } from "../env";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { text, speaker, emotion } = body;

    const url = "https://api.topmediai.com/v1/text2speech";
    const payload = {
      text,
      speaker,
      emotion
    };
    
    // Ensure API key exists
    const apiKey = env.TOPMEDAI_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "API key not configured" },
        { status: 500 }
      );
    }
    
    const headers = {
      "Content-Type": "application/json",
      "x-api-key": apiKey
    };
    
    const response = await fetch(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload)
    });

    // Handle the response
    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `API request failed: ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
    
  } catch (error) {
    console.error("Error in text-to-speech API:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}



