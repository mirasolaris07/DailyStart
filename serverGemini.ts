import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "" });

export async function generateServerBriefing(
    events: any[],
    tasks: any[],
    userFocus: string = ""
) {
    const modelName = process.env.VITE_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-3-flash-preview";

    const prompt = `
    You are a supportive morning productivity coach. 
    
    CRITICAL CONTEXT:
    1. User's Manual Focus for today: "${userFocus}"
    2. User's Schedule: ${JSON.stringify(events)}
    3. Existing Tasks (includes Nightly Commitments): ${JSON.stringify(tasks)}

    Please provide:
    1. A concise summary of their day (meetings and priorities, emphasizing their stated focus).
    2. A warm, encouraging message to start the day.
    3. Selection of top 3 "Active Focus" tasks from their existing list.
       - Prioritize tasks that match the User's Manual Focus.
       - Then prioritize tasks described as "Nightly Commitment".
       - Then pick remaining urgent/important tasks.
       - For each, provide 3-4 micro-steps and a suggested priority level (1-3). 
  `;

    try {
        const response = await ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        summary: { type: Type.STRING },
                        encouragement: { type: Type.STRING },
                        tasksWithSteps: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    title: { type: Type.STRING },
                                    priority: { type: Type.NUMBER },
                                    steps: {
                                        type: Type.ARRAY,
                                        items: { type: Type.STRING }
                                    }
                                },
                                required: ["title", "steps", "priority"]
                            }
                        }
                    },
                    required: ["summary", "encouragement", "tasksWithSteps"]
                }
            }
        });

        return JSON.parse(response.text || "{}");
    } catch (e) {
        console.error("Server-side Gemini briefing failed", e);
        return null;
    }
}
