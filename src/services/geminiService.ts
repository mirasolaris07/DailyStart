import { GoogleGenAI, Type } from "@google/genai";
import { BriefingData, CalendarEvent, Task } from "../types";

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || "" });

export async function generateMorningBriefing(
  events: CalendarEvent[],
  tasks: Task[],
  userFocus: string = ""
): Promise<BriefingData> {
  const model = import.meta.env.VITE_GEMINI_MODEL || "gemini-3-flash-preview";

  const prompt = `
    You are a supportive morning productivity coach. 
    
    CRITICAL CONTEXT:
    1. User's Manual Focus for today: "${userFocus}"
    2. User's Schedule: ${JSON.stringify(events)}
    3. Existing Tasks (includes Nightly Commitments): ${JSON.stringify(tasks)}

    Please provide:
    1. A concise summary of their day (meetings and priorities, emphasizing their stated focus).
    2. A warm, encouraging message to start the day.
    3. Selection of top 3 "Active Focus" tasks. 
       - Prioritize tasks that match the User's Manual Focus.
       - Then prioritize tasks described as "Nightly Commitment".
       - Then pick remaining urgent/important tasks.
       - For each, provide 3-4 micro-steps and a suggested priority level (1-3). 
       - CRITICAL: For these existing tasks, set "isSuggested" to false.
    4. Suggest 2-3 NEW "proposed tasks" only if gaps exist or to help with their stated focus.
       - For each, provide 3-4 micro-steps and a suggested priority level (1-3). 
       - CRITICAL: For these new suggested tasks, set "isSuggested" to true and "taskId" to null.

    Respond in JSON format.
  `;

  const response = await ai.models.generateContent({
    model,
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
                taskId: { type: Type.NUMBER, nullable: true },
                title: { type: Type.STRING },
                priority: { type: Type.NUMBER },
                isSuggested: { type: Type.BOOLEAN },
                steps: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                }
              },
              required: ["title", "steps", "priority", "isSuggested"]
            }
          }
        },
        required: ["summary", "encouragement", "tasksWithSteps"]
      }
    }
  });

  const briefing = JSON.parse(response.text || "{}");

  // Generate an encouraging image
  const imagePrompt = `A beautiful, serene, and inspiring morning landscape, minimalist style, soft lighting, professional photography, representing a fresh start and productivity. No text.`;

  try {
    const imageResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts: [{ text: imagePrompt }] },
    });

    for (const part of imageResponse.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        briefing.imageUrl = `data:image/png;base64,${part.inlineData.data}`;
        break;
      }
    }
  } catch (e) {
    console.error("Image generation failed", e);
  }

  return briefing;
}
