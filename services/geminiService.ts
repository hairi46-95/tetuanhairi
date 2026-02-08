
import { GoogleGenAI, Type } from "@google/genai";

export async function analyzeLegalServices(services: string[], clientInfo: string) {
  try {
    if (!process.env.API_KEY) {
      console.warn("API_KEY is missing.");
      return "Sila masukkan API KEY untuk menggunakan fungsi AI.";
    }
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Sila berikan rumusan ringkas (maksimum 3 ayat) tentang prosedur perundangan untuk perkhidmatan berikut: ${services.join(', ')}. Maklumat pelanggan: ${clientInfo}. Bahasa: Bahasa Melayu.`,
      config: {
        temperature: 0.7,
        topP: 0.9,
      }
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Maaf, AI gagal menjana rumusan buat masa ini. Sila cuba sebentar lagi.";
  }
}

export async function generateLegalAdvice(services: string[]) {
  try {
    if (!process.env.API_KEY) {
       console.warn("API_KEY is missing.");
       return { tips: ["Sila hubungi pentadbir sistem untuk mengaktifkan fungsi AI."] };
    }
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Anda adalah peguam syarie pakar. Berikan 3 tips perundangan yang sangat ringkas, padat dan bermanfaat untuk pelanggan yang mengambil servis: ${services.join(', ')}. Fokus kepada langkah persediaan atau pesanan penting.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            tips: {
              type: Type.ARRAY,
              items: { 
                type: Type.STRING,
                description: "Tip perundangan ringkas dalam Bahasa Melayu."
              }
            }
          },
          required: ["tips"]
        }
      }
    });
    
    const text = response.text;
    if (!text) return { tips: [] };
    
    try {
      return JSON.parse(text);
    } catch (parseError) {
      console.error("JSON Parse Error:", parseError);
      return { tips: ["Gagal memproses respons AI."] };
    }

  } catch (error) {
    console.error("Gemini Advice Error:", error);
    return { 
      tips: [
        "Sila pastikan semua dokumen asal dibawa semasa perjumpaan.",
        "Catat setiap tarikh penting yang dimaklumkan oleh pejabat peguam.",
        "Sediakan salinan kad pengenalan dan dokumen berkaitan secukupnya."
      ] 
    };
  }
}
