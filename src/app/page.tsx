"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const [text, setText] = useState("");
  const [speaker, setSpeaker] = useState("5ccc6825-3a96-11ee-ab0d-8cec4b691ee9"); // Default speaker ID
  const [emotion, setEmotion] = useState("Neutral");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState<any>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          speaker,
          emotion,
        }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Something went wrong");
      }

      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process request");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full max-w-md mt-100">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Enter text to convert"
          className="p-2 border rounded"
          required
        />
        
        <input
          type="text"
          value={speaker}
          onChange={(e) => setSpeaker(e.target.value)}
          placeholder="Speaker ID"
          className="p-2 border rounded"
        />
        
        <select
          value={emotion}
          onChange={(e) => setEmotion(e.target.value)}
          className="p-2 border rounded"
        >
          <option value="Neutral">Neutral</option>
          <option value="Happy">Happy</option>
          <option value="Sad">Sad</option>
          {/* Add more emotion options as needed */}
        </select>

        <button
          type="submit"
          disabled={loading}
          className="p-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
        >
          {loading ? "Processing..." : "Convert to Speech"}
        </button>
      </form>

      {error && (
        <div className="text-red-500 mt-4">
          {error}
        </div>
      )}
          {console.log(response)}

      {response && (
        <div className="mt-4">
          <audio src={response.data.oss_url} controls />
        </div>
      )}
    </div>
  );
}
