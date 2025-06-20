"use client";
import { useEffect, useState } from "react";
import Image from 'next/image';

export default function VideoPage() {
  return (
    <div className="relative w-full h-screen">
      {/* Video background */}
      <div className="absolute w-full h-full flex items-center justify-center"> 
      <video 
        className="h-full object-cover"
        autoPlay 
        loop 
        muted
      >
        <source src="/gameplay/subwaysurfers.mp4" type="video/mp4" />
        
      </video>
      </div>
      {/* Peter Griffin overlay */}
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 flex">
        <Image
          src="/gameplay/stewie.png"
          alt="Stewie"
          width={300}
          height={300}
          className="z-10"
        />
        <Image
          src="/gameplay/peter.png"
          alt="Peter"
          width={300}
          height={300}
          className="z-10 transform scale-x-[-1]"
        />
      </div>
    </div>
  );
} 