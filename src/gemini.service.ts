import { Injectable } from '@angular/core';
import { GoogleGenAI } from '@google/genai';

@Injectable({
  providedIn: 'root',
})
export class GeminiService {
  private ai: GoogleGenAI | null = null;

  constructor() {
    if (process.env.API_KEY) {
      this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    } else {
      console.error(
        'API_KEY environment variable not set. Gemini Service will not work.'
      );
    }
  }

  async removeBackground(base64ImageDataUrl: string): Promise<string> {
    if (!this.ai) {
      throw new Error('Клиент Gemini AI не инициализирован. Проверьте API_KEY.');
    }

    if (!base64ImageDataUrl.startsWith('data:image')) {
      throw new Error('Неверный формат URL данных изображения.');
    }

    const [header, base64Data] = base64ImageDataUrl.split(',');
    if (!base64Data) {
      throw new Error('Не удалось извлечь данные base64 из URL.');
    }
    const mimeType = header.match(/:(.*?);/)?.[1] ?? 'image/png';

    const imagePart = {
      inlineData: {
        data: base64Data,
        mimeType,
      },
    };

    const prompt = `Your role is an automated image processing service.
You will receive an image of a signature.
Your ONLY job is to perform the following transformations:
1. Isolate the signature from its background.
2. Make the background 100% transparent.
3. Convert the signature strokes to solid black (#000000).
4. Return the resulting image as a transparent PNG.

Your entire output MUST be the raw base64 encoded string of the final PNG image.
Absolutely NO other text, characters, markdown, or explanations.
For example, your output should start with 'iVBORw0KGgo...' and nothing else.
Do not write code. Execute the image processing and return the base64 data.`;

    try {
      const result = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [imagePart, { text: prompt }] },
      });

      // More robust parsing to handle potential markdown code blocks.
      let base64Response = result.text.trim();
      base64Response = base64Response
        .replace(/^```(?:\w+\n)?/, '')
        .replace(/```$/, '')
        .trim();

      // A simple regex to validate if the response contains only base64 characters and whitespace.
      if (!/^[A-Za-z0-9+/=\s]+$/.test(base64Response)) {
        console.error(
          'AI response does not appear to be a valid base64 string:',
          base64Response
        );
        throw new Error('ИИ вернул неверный формат данных.');
      }

      // Remove any whitespace from the base64 string
      const finalBase64 = base64Response.replace(/\s/g, '');

      return `data:image/png;base64,${finalBase64}`;
    } catch (error) {
      console.error('Error calling Gemini API for background removal:', error);
      if (
        error instanceof Error &&
        error.message.includes('неверный формат данных')
      ) {
        throw error;
      }
      throw new Error(
        'Не удалось обработать подпись с помощью ИИ. Пожалуйста, попробуйте еще раз.'
      );
    }
  }
}
