import { useState, useEffect, useRef, useCallback } from "react";
import {
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  View,
  Text,
  Keyboard,
  Image,
  Alert,
  ScrollView,
  Modal,
  Share,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import { BlurView } from "expo-blur";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";
import { CactusLM, type Message as CactusMessage, type Tool } from "cactus-react-native";

const VISION_TOOLS: Tool[] = [
  {
    name: "report_damage",
    description: "Report the structured damage analysis from the image. Always use this tool to provide your analysis.",
    parameters: {
      type: "object",
      properties: {
        severity: {
          type: "number",
          description: "Damage severity from 1-10 (1=minor scratch, 10=total loss)",
        },
        damage_type: {
          type: "string",
          description: "Primary type of damage: dent, scratch, crack, shatter, bend, rust, burn, flood, or other",
        },
        affected_area: {
          type: "string",
          description: "Location on the vehicle: front bumper, rear bumper, hood, roof, door, fender, windshield, headlight, taillight, wheel, undercarriage, or interior",
        },
        description: {
          type: "string",
          description: "Detailed description of the visible damage",
        },
        repair_estimate: {
          type: "string",
          description: "Estimated repair category: minor (under $500), moderate ($500-$2500), major ($2500-$10000), or severe (over $10000)",
        },
      },
      required: ["severity", "damage_type", "affected_area", "description", "repair_estimate"],
    },
  },
];

const TEXT_TOOLS: Tool[] = [
  {
    name: "generate_report",
    description: "Generate a formatted insurance inspection report from the conversation. Call this when the user indicates they are done with the inspection, says 'ok', 'done', 'generate report', 'finish', 'complete', or asks for a summary/report.",
    parameters: {
      type: "object",
      properties: {
        severity: {
          type: "number",
          description: "Overall damage severity from 1-10",
        },
        summary: {
          type: "string",
          description: "Brief 1-2 sentence summary of the damage",
        },
        damage_description: {
          type: "string",
          description: "Detailed description of all damage found",
        },
        recommendations: {
          type: "string",
          description: "Recommended next steps for the claim",
        },
      },
      required: ["severity", "summary", "damage_description", "recommendations"],
    },
  },
];

type StoredDocument = {
  id: string;
  name: string;
  chunks: string[];
  embeddings: number[][];
  createdAt: string;
};

const STORAGE_KEY = "inspai_knowledge_base";

type Source = {
  docName: string;
  chunk: string;
  score: number;
};

type DamageAnalysis = {
  severity: number;
  damage_type: string;
  affected_area: string;
  description: string;
  repair_estimate: string;
};

type Message = {
  id: string;
  text: string;
  isUser: boolean;
  image?: string;
  sources?: Source[];
  isSearching?: boolean;
  reasoning?: string;
  pdfUri?: string;
  report?: Report;
  damageAnalysis?: DamageAnalysis;
};

type Report = {
  id: string;
  date: string;
  time: string;
  summary: string;
  severity: string;
  damageDescription: string;
  recommendations: string;
  images: string[];
  policyReferences: string[];
};

// Cosine similarity between two vectors
const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
};

export default function InspectionScreen() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [visionModel, setVisionModel] = useState<CactusLM | null>(null);
  const [textModel, setTextModel] = useState<CactusLM | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState("Initializing...");
  const [isGenerating, setIsGenerating] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const chatHistoryRef = useRef<CactusMessage[]>([]);
  const documentsRef = useRef<StoredDocument[]>([]);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(
    new Set(),
  );
  const [expandedReasoning, setExpandedReasoning] = useState<Set<string>>(
    new Set(),
  );
  const [showReport, setShowReport] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);

  const toggleSources = useCallback((messageId: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }, []);

  const toggleReasoning = useCallback((messageId: string) => {
    setExpandedReasoning((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }, []);

  const generateReport = async () => {
    if (!textModel || messages.length < 2) {
      Alert.alert("Not enough data", "Please complete the inspection first.");
      return;
    }

    setGeneratingReport(true);

    try {
      // Collect all images from chat
      const images = messages.filter(m => m.image).map(m => m.image!);

      // Collect all AI responses (damage assessments)
      const assessments = messages.filter(m => !m.isUser && m.text && !m.isSearching).map(m => m.text);

      // Collect policy references
      const policyRefs: string[] = [];
      messages.forEach(m => {
        if (m.sources) {
          m.sources.forEach(s => {
            if (!policyRefs.includes(s.chunk.substring(0, 100))) {
              policyRefs.push(s.chunk.substring(0, 100) + "...");
            }
          });
        }
      });

      // Build context for report generation
      const chatContext = messages
        .filter(m => m.text && !m.isSearching)
        .map(m => `${m.isUser ? "Inspector" : "AI"}: ${m.text}`)
        .join("\n");

      const prompt = `Based on this inspection conversation, generate a structured insurance claim report. Extract:
1. Overall severity (1-10)
2. Brief summary (1-2 sentences)
3. Detailed damage description
4. Recommendations for next steps

Conversation:
${chatContext}

Respond in this exact format:
SEVERITY: [number]
SUMMARY: [text]
DAMAGE: [text]
RECOMMENDATIONS: [text]`;

      const result = await textModel.complete({
        messages: [
          { role: "system", content: "You are an insurance report generator. Be concise and professional." },
          { role: "user", content: prompt }
        ]
      });

      const response = result.response;

      // Parse the response
      const severityMatch = response.match(/SEVERITY:\s*(\d+)/i);
      const summaryMatch = response.match(/SUMMARY:\s*(.+?)(?=DAMAGE:|$)/is);
      const damageMatch = response.match(/DAMAGE:\s*(.+?)(?=RECOMMENDATIONS:|$)/is);
      const recsMatch = response.match(/RECOMMENDATIONS:\s*(.+?)$/is);

      const now = new Date();
      const newReport: Report = {
        id: `RPT-${Date.now()}`,
        date: now.toLocaleDateString(),
        time: now.toLocaleTimeString(),
        severity: severityMatch ? severityMatch[1] : "N/A",
        summary: summaryMatch ? summaryMatch[1].trim() : assessments[0] || "Inspection completed.",
        damageDescription: damageMatch ? damageMatch[1].trim() : assessments.join("\n\n"),
        recommendations: recsMatch ? recsMatch[1].trim() : "Submit for review.",
        images,
        policyReferences: policyRefs,
      };

      setReport(newReport);
      setShowReport(true);
    } catch (e) {
      console.error("Report generation error:", e);
      Alert.alert("Error", "Failed to generate report.");
    } finally {
      setGeneratingReport(false);
    }
  };

  const shareReport = async () => {
    if (!report) return;

    const reportText = `
INSPECTION REPORT
=================
Report ID: ${report.id}
Date: ${report.date} ${report.time}

SEVERITY: ${report.severity}/10

SUMMARY:
${report.summary}

DAMAGE DESCRIPTION:
${report.damageDescription}

RECOMMENDATIONS:
${report.recommendations}

IMAGES ATTACHED: ${report.images.length}
POLICY REFERENCES: ${report.policyReferences.length}

---
Generated by inspAI
    `.trim();

    try {
      await Share.share({ message: reportText });
    } catch (e) {
      console.error("Share error:", e);
    }
  };

  useEffect(() => {
    loadModels();
    loadDocuments();
    return () => {
      visionModel?.destroy();
      textModel?.destroy();
    };
  }, []);

  const loadDocuments = async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        documentsRef.current = JSON.parse(stored);
      }
    } catch (e) {
      console.error("Failed to load documents:", e);
    }
  };

  const retrieveRelevantContext = async (
    query: string,
  ): Promise<{ context: string; sources: Source[] }> => {
    if (!textModel || documentsRef.current.length === 0)
      return { context: "", sources: [] };

    try {
      const queryResult = await textModel.embed({ text: query });
      const queryEmbedding = queryResult.embedding;

      const scoredChunks: Source[] = [];

      for (const doc of documentsRef.current) {
        for (let i = 0; i < doc.chunks.length; i++) {
          const score = cosineSimilarity(queryEmbedding, doc.embeddings[i]);
          scoredChunks.push({ chunk: doc.chunks[i], score, docName: doc.name });
        }
      }

      scoredChunks.sort((a, b) => b.score - a.score);
      const topChunks = scoredChunks.slice(0, 3).filter((c) => c.score > 0.5);

      if (topChunks.length === 0) return { context: "", sources: [] };

      const context = topChunks
        .map((c) => `[From ${c.docName}]: ${c.chunk}`)
        .join("\n\n");

      return { context, sources: topChunks };
    } catch (e) {
      console.error("RAG error:", e);
      return { context: "", sources: [] };
    }
  };

  const loadModels = async () => {
    try {
      setLoadingStatus("Loading text model...");
      const textLM = new CactusLM({
        model: "qwen3-0.6b",
        options: { quantization: "int4", contextSize: 2048 },
      });

      await textLM.download({
        onProgress: (p) => setProgress(Math.round(p * 50)), // 0-50%
      });
      await textLM.init();
      setTextModel(textLM);

      setLoadingStatus("Loading vision model...");
      const visionLM = new CactusLM({
        model: "lfm2-vl-450m",
        options: { quantization: "int4", contextSize: 2048 },
      });

      await visionLM.download({
        onProgress: (p) => setProgress(50 + Math.round(p * 50)), // 50-100%
      });
      await visionLM.init();
      setVisionModel(visionLM);

      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      const docs = stored ? JSON.parse(stored) : [];
      const kbStatus =
        docs.length > 0
          ? `Knowledge base: ${docs.length} document(s) loaded`
          : "No policy documents. Add them in Knowledge tab.";

      setMessages([
        {
          id: "0",
          text: `Ready! Upload a photo for damage analysis, or ask about your policy.\n\n${kbStatus}`,
          isUser: false,
        },
      ]);
    } catch (e) {
      console.error("Model loading error:", e);
      setMessages([{ id: "0", text: "Failed to load models.", isUser: false }]);
    } finally {
      setLoading(false);
    }
  };

  const cleanResponse = (
    text: string,
  ): { clean: string; reasoning: string } => {
    const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/i);
    const reasoning = thinkMatch ? thinkMatch[1].trim() : "";

    let clean = text
      // Remove complete think blocks
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      // Remove orphan opening tags
      .replace(/<think>/gi, "")
      // Remove orphan closing tags
      .replace(/<\/think>/gi, "")
      // Remove other special tokens
      .replace(/<\|.*?\|>/gi, "")
      // Remove multiple newlines
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return { clean, reasoning };
  };

  const generatePdfFromReport = async (reportData: Report): Promise<string | null> => {
    try {
      // Convert images to base64 for embedding in PDF
      const imageHtml = await Promise.all(
        reportData.images.slice(0, 4).map(async (uri, idx) => {
          try {
            const base64 = await FileSystem.readAsStringAsync(uri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            return `<img src="data:image/jpeg;base64,${base64}" style="width:200px;height:150px;object-fit:cover;border-radius:8px;margin:4px;" />`;
          } catch {
            return "";
          }
        })
      );

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, sans-serif; padding: 40px; color: #333; }
            .header { text-align: center; margin-bottom: 30px; }
            .logo { font-size: 24px; font-weight: bold; color: #007AFF; }
            .report-id { color: #888; font-size: 14px; margin-top: 8px; }
            .severity-box { background: #000; color: #fff; padding: 30px; border-radius: 16px; text-align: center; margin: 20px 0; }
            .severity-label { font-size: 12px; color: #888; text-transform: uppercase; }
            .severity-value { font-size: 64px; font-weight: 800; }
            .section { background: #f5f5f5; padding: 20px; border-radius: 12px; margin: 16px 0; }
            .section-title { font-size: 11px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }
            .section-content { font-size: 15px; line-height: 1.6; }
            .images { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
            .footer { text-align: center; margin-top: 40px; color: #888; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="logo">inspAI</div>
            <div class="report-id">${reportData.id}</div>
            <div class="report-id">${reportData.date} at ${reportData.time}</div>
          </div>

          <div class="severity-box">
            <div class="severity-label">Damage Severity</div>
            <div class="severity-value">${reportData.severity}/10</div>
          </div>

          <div class="section">
            <div class="section-title">Summary</div>
            <div class="section-content">${reportData.summary}</div>
          </div>

          <div class="section">
            <div class="section-title">Damage Description</div>
            <div class="section-content">${reportData.damageDescription}</div>
          </div>

          <div class="section">
            <div class="section-title">Recommendations</div>
            <div class="section-content">${reportData.recommendations}</div>
          </div>

          ${reportData.images.length > 0 ? `
          <div class="section">
            <div class="section-title">Attached Images (${reportData.images.length})</div>
            <div class="images">${imageHtml.join("")}</div>
          </div>
          ` : ""}

          ${reportData.policyReferences.length > 0 ? `
          <div class="section">
            <div class="section-title">Policy References</div>
            ${reportData.policyReferences.map(ref => `<div class="section-content" style="font-size:12px;margin-bottom:8px;">${ref}</div>`).join("")}
          </div>
          ` : ""}

          <div class="footer">
            Generated by inspAI - On-device AI Inspection
          </div>
        </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({ html });

      // Move to a permanent location with proper name
      const pdfName = `${reportData.id}.pdf`;
      const pdfPath = `${FileSystem.documentDirectory}${pdfName}`;
      await FileSystem.moveAsync({ from: uri, to: pdfPath });

      return pdfPath;
    } catch (e) {
      console.error("PDF generation error:", e);
      return null;
    }
  };

  const openPdf = async (uri: string) => {
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: "application/pdf",
          dialogTitle: "Inspection Report",
        });
      }
    } catch (e) {
      console.error("Error opening PDF:", e);
    }
  };

  const handleToolCall = async (functionCalls: any[]): Promise<{ response: string; report: Report; pdfUri: string | null } | null> => {
    for (const call of functionCalls) {
      if (call.name === "generate_report") {
        const args = call.arguments || {};
        const images = messages.filter(m => m.image).map(m => m.image!);
        const policyRefs: string[] = [];
        messages.forEach(m => {
          m.sources?.forEach(s => {
            if (!policyRefs.includes(s.chunk.substring(0, 100))) {
              policyRefs.push(s.chunk.substring(0, 100) + "...");
            }
          });
        });

        const damageAnalyses = messages
          .filter(m => m.damageAnalysis)
          .map(m => m.damageAnalysis!);

        let severity = args.severity;
        let damageDescription = args.damage_description;

        if (damageAnalyses.length > 0) {
          const avgSeverity = Math.round(
            damageAnalyses.reduce((sum, d) => sum + d.severity, 0) / damageAnalyses.length
          );
          severity = severity || avgSeverity;

          const structuredDesc = damageAnalyses.map((d, i) =>
            `**Damage ${i + 1}:** ${d.damage_type} on ${d.affected_area} (Severity: ${d.severity}/10)\n${d.description}\nEstimated repair: ${d.repair_estimate}`
          ).join("\n\n");

          damageDescription = damageDescription || structuredDesc;
        }

        const now = new Date();
        const newReport: Report = {
          id: `RPT-${Date.now()}`,
          date: now.toLocaleDateString(),
          time: now.toLocaleTimeString(),
          severity: String(severity || "N/A"),
          summary: args.summary || (damageAnalyses.length > 0
            ? `${damageAnalyses.length} damage area(s) identified. Primary damage: ${damageAnalyses[0].damage_type} on ${damageAnalyses[0].affected_area}.`
            : "Inspection completed."),
          damageDescription: damageDescription || "See chat history.",
          recommendations: args.recommendations || "Submit for review.",
          images,
          policyReferences: policyRefs,
        };

        const pdfUri = await generatePdfFromReport(newReport);

        setReport(newReport);

        return {
          response: `Report generated with ${damageAnalyses.length} damage assessment(s). Tap to view or share the PDF.`,
          report: newReport,
          pdfUri,
        };
      }
    }
    return null;
  };

  const formatDamageAnalysis = (analysis: DamageAnalysis): string => {
    const severityLabel = analysis.severity <= 3 ? "Minor" : analysis.severity <= 6 ? "Moderate" : analysis.severity <= 8 ? "Significant" : "Severe";
    return `**Damage Assessment**

**Severity:** ${analysis.severity}/10 (${severityLabel})
**Type:** ${analysis.damage_type}
**Location:** ${analysis.affected_area}

**Description:**
${analysis.description}

**Repair Estimate:** ${analysis.repair_estimate}`;
  };

  const generateResponse = async (
    text: string,
    imageUri?: string,
    messageId?: string,
  ): Promise<{ response: string; sources: Source[]; reasoning: string; damageAnalysis?: DamageAnalysis }> => {
    const model = imageUri ? visionModel : textModel;
    if (!model)
      return { response: "Model not loaded.", sources: [], reasoning: "" };

    try {
      const imagePath = imageUri?.replace("file://", "");
      const userMsg = imageUri
        ? { role: "user" as const, content: text, images: [imagePath] }
        : { role: "user" as const, content: text };

      let policyContext = "";
      let sources: Source[] = [];

      if (!imageUri && textModel) {
        const ragResult = await retrieveRelevantContext(text);
        policyContext = ragResult.context;
        sources = ragResult.sources;
      }

      const systemPrompt = imageUri
        ? "You are a vehicle damage inspection AI. Analyze the image carefully and use the report_damage tool to provide a structured assessment. Look for dents, scratches, cracks, broken parts, and any other visible damage. Be thorough and accurate."
        : policyContext
          ? `You are an insurance policy assistant. Answer questions using ONLY the policy context below. Be specific and cite section numbers when possible. When the user is done or asks for a report, use the generate_report tool.

POLICY CONTEXT:
${policyContext}`
          : "You are an insurance inspection assistant. Help analyze damage and answer policy questions. When the user indicates they are done (says 'ok', 'done', 'generate report', 'finish', etc.), use the generate_report tool to create a formal report.";

      const allMessages: CactusMessage[] = [
        { role: "system", content: systemPrompt },
        ...chatHistoryRef.current,
        userMsg,
      ];

      let streamedText = "";

      const onToken = (token: string) => {
        streamedText += token;
        if (messageId) {
          const { clean } = cleanResponse(streamedText);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId ? { ...m, text: clean || "Analyzing..." } : m,
            ),
          );
        }
      };

      const tools = imageUri ? VISION_TOOLS : TEXT_TOOLS;

      const result = await model.complete({
        messages: allMessages,
        onToken,
        tools,
        options: imageUri ? { forceTools: true } : undefined,
      });

      if (imageUri && result.functionCalls && result.functionCalls.length > 0) {
        for (const call of result.functionCalls) {
          if (call.name === "report_damage") {
            const args = call.arguments as DamageAnalysis;
            const formattedResponse = formatDamageAnalysis(args);

            chatHistoryRef.current = [
              ...chatHistoryRef.current,
              { role: "user", content: "Image uploaded for damage analysis" },
              { role: "assistant", content: formattedResponse },
            ];

            if (messageId) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === messageId
                    ? { ...m, text: formattedResponse, damageAnalysis: args }
                    : m
                )
              );
            }

            return { response: formattedResponse, sources: [], reasoning: "", damageAnalysis: args };
          }
        }
      }

      if (!imageUri && result.functionCalls && result.functionCalls.length > 0) {
        const toolResult = await handleToolCall(result.functionCalls);
        if (toolResult) {
          chatHistoryRef.current = [
            ...chatHistoryRef.current,
            { role: "user", content: text },
            { role: "assistant", content: toolResult.response },
          ];

          if (messageId && toolResult.pdfUri) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === messageId
                  ? { ...m, text: toolResult.response, pdfUri: toolResult.pdfUri!, report: toolResult.report }
                  : m
              )
            );
          }

          return { response: toolResult.response, sources, reasoning: "" };
        }
      }

      const { clean, reasoning } = cleanResponse(result.response);

      chatHistoryRef.current = [
        ...chatHistoryRef.current,
        { role: "user", content: text },
        { role: "assistant", content: clean },
      ];

      return { response: clean, sources, reasoning };
    } catch (e) {
      console.error("Generation error:", e);
      return {
        response: "Error generating response.",
        sources: [],
        reasoning: "",
      };
    }
  };

  const send = async (text?: string, imageUri?: string) => {
    const msg = text || input.trim();
    if ((!msg && !imageUri) || isGenerating) return;

    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        text: msg || "Photo",
        isUser: true,
        image: imageUri,
      },
    ]);
    setInput("");
    setIsGenerating(true);
    Keyboard.dismiss();

    const thinkingId = (Date.now() + 1).toString();

    // Show searching indicator for text queries (RAG)
    if (!imageUri && documentsRef.current.length > 0) {
      setMessages((prev) => [
        ...prev,
        {
          id: thinkingId,
          text: "Searching knowledge base...",
          isUser: false,
          isSearching: true,
        },
      ]);

      // Brief delay to show the searching state
      await new Promise((resolve) => setTimeout(resolve, 500));

      setMessages((prev) =>
        prev.map((m) =>
          m.id === thinkingId
            ? { ...m, text: "Generating response...", isSearching: false }
            : m,
        ),
      );
    } else {
      setMessages((prev) => [
        ...prev,
        { id: thinkingId, text: "Analyzing...", isUser: false },
      ]);
    }

    const { response, sources, reasoning, damageAnalysis } = await generateResponse(
      msg || "Analyze this image for damage.",
      imageUri,
      thinkingId,
    );

    setMessages((prev) =>
      prev.map((m) =>
        m.id === thinkingId
          ? { ...m, text: response, sources, reasoning, damageAnalysis, isSearching: false }
          : m,
      ),
    );
    setIsGenerating(false);
  };

  const pickImage = async (camera: boolean) => {
    try {
      if (camera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return Alert.alert("Need camera access");
      }

      const result = camera
        ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });

      if (!result.canceled && result.assets?.[0]?.uri) {
        send("Analyze this.", result.assets[0].uri);
      }
    } catch {
      Alert.alert("Error picking image");
    }
  };

  if (loading) {
    return (
      <>
        <Stack.Screen
          options={{ title: "Inspection", headerBackTitle: "Back" }}
        />
        <View style={styles.loading}>
          <BlurView intensity={50} tint="light" style={styles.loadingCard}>
            <ActivityIndicator color="#000" size="large" />
            <Text style={styles.loadingTitle}>Loading AI</Text>
            <Text style={styles.loadingText}>
              {progress > 0 ? `${progress}%` : loadingStatus}
            </Text>
            <Text style={styles.loadingSubtext}>{loadingStatus}</Text>
            {progress > 0 && (
              <View style={styles.progressBar}>
                <View
                  style={[styles.progressFill, { width: `${progress}%` }]}
                />
              </View>
            )}
          </BlurView>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{ title: "Inspection", headerBackTitle: "Back" }}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.container}
        keyboardVerticalOffset={90}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messages}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
          keyboardDismissMode="interactive"
          renderItem={({ item }) => (
            <View
              style={[
                styles.messageContainer,
                item.isUser && styles.messageContainerUser,
              ]}
            >
              <View
                style={[styles.bubble, item.isUser ? styles.user : styles.bot]}
              >
                {item.image && (
                  <Image source={{ uri: item.image }} style={styles.image} />
                )}
                {item.isSearching && (
                  <View style={styles.searchingRow}>
                    <ActivityIndicator size="small" color="#666" />
                    <Text style={styles.searchingText}>{item.text}</Text>
                  </View>
                )}
                {!item.isSearching && !item.damageAnalysis && (
                  <Text
                    style={[styles.bubbleText, item.isUser && styles.userText]}
                  >
                    {item.text}
                  </Text>
                )}

                {/* Structured Damage Analysis Card */}
                {item.damageAnalysis && (
                  <View style={styles.damageCard}>
                    <View style={styles.damageHeader}>
                      <View style={[
                        styles.severityBadge,
                        item.damageAnalysis.severity <= 3 && styles.severityLow,
                        item.damageAnalysis.severity > 3 && item.damageAnalysis.severity <= 6 && styles.severityMed,
                        item.damageAnalysis.severity > 6 && styles.severityHigh,
                      ]}>
                        <Text style={styles.severityBadgeText}>{item.damageAnalysis.severity}/10</Text>
                      </View>
                      <View style={styles.damageHeaderText}>
                        <Text style={styles.damageType}>{item.damageAnalysis.damage_type}</Text>
                        <Text style={styles.damageLocation}>{item.damageAnalysis.affected_area}</Text>
                      </View>
                    </View>
                    <Text style={styles.damageDescription}>{item.damageAnalysis.description}</Text>
                    <View style={styles.repairEstimate}>
                      <Text style={styles.repairLabel}>Repair Estimate:</Text>
                      <Text style={styles.repairValue}>{item.damageAnalysis.repair_estimate}</Text>
                    </View>
                  </View>
                )}

                {/* PDF Report Card */}
                {item.pdfUri && item.report && (
                  <TouchableOpacity
                    style={styles.pdfCard}
                    onPress={() => openPdf(item.pdfUri!)}
                    onLongPress={() => {
                      setReport(item.report!);
                      setShowReport(true);
                    }}
                  >
                    <View style={styles.pdfIcon}>
                      <Text style={styles.pdfIconText}>PDF</Text>
                    </View>
                    <View style={styles.pdfInfo}>
                      <Text style={styles.pdfTitle}>{item.report.id}</Text>
                      <Text style={styles.pdfSubtitle}>Severity: {item.report.severity}/10 · Tap to share</Text>
                    </View>
                    <Text style={styles.pdfArrow}>›</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Action buttons row */}
              {!item.isUser &&
                !item.isSearching &&
                (item.reasoning ||
                  (item.sources && item.sources.length > 0)) && (
                  <View style={styles.actionButtonsRow}>
                    {item.reasoning && (
                      <TouchableOpacity
                        onPress={() => toggleReasoning(item.id)}
                        style={[
                          styles.actionButton,
                          expandedReasoning.has(item.id) &&
                            styles.actionButtonActive,
                        ]}
                      >
                        <Text style={styles.actionButtonText}>
                          {expandedReasoning.has(item.id) ? "Hide" : "Show"}{" "}
                          Reasoning
                        </Text>
                      </TouchableOpacity>
                    )}
                    {item.sources && item.sources.length > 0 && (
                      <TouchableOpacity
                        onPress={() => toggleSources(item.id)}
                        style={[
                          styles.actionButton,
                          expandedSources.has(item.id) &&
                            styles.actionButtonActive,
                        ]}
                      >
                        <Text style={styles.actionButtonText}>
                          {item.sources.length} Source
                          {item.sources.length > 1 ? "s" : ""}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}

              {/* Reasoning section */}
              {item.reasoning && expandedReasoning.has(item.id) && (
                <View style={styles.reasoningContainer}>
                  <View style={styles.reasoningTab}>
                    <Text style={styles.reasoningTitle}>Model Thinking</Text>
                  </View>
                  <ScrollView
                    style={styles.reasoningContent}
                    nestedScrollEnabled
                  >
                    <Text style={styles.reasoningText}>{item.reasoning}</Text>
                  </ScrollView>
                </View>
              )}

              {/* Sources section */}
              {item.sources &&
                item.sources.length > 0 &&
                expandedSources.has(item.id) && (
                  <View style={styles.sourcesContainer}>
                    <Text style={styles.sourcesListTitle}>
                      Referenced Sources
                    </Text>
                    <View style={styles.sourcesList}>
                      {item.sources.map((source, idx) => (
                        <View key={idx} style={styles.sourceItem}>
                          <View style={styles.sourceHeader}>
                            <Text style={styles.sourceDocName}>
                              {source.docName}
                            </Text>
                            <Text style={styles.sourceScore}>
                              {Math.round(source.score * 100)}% match
                            </Text>
                          </View>
                          <Text style={styles.sourceChunk} numberOfLines={2}>
                            {source.chunk}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
            </View>
          )}
        />

        <BlurView
          intensity={60}
          tint="light"
          style={[styles.inputArea, { paddingBottom: insets.bottom || 16 }]}
        >
          <View style={styles.buttonRow}>
            <TouchableOpacity
              onPress={() => pickImage(true)}
              style={styles.actionBtn}
            >
              <Text style={styles.actionText}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => pickImage(false)}
              style={styles.actionBtn}
            >
              <Text style={styles.actionText}>Gallery</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={generateReport}
              disabled={generatingReport || messages.length < 2}
              style={[styles.reportBtn, (generatingReport || messages.length < 2) && styles.disabled]}
            >
              {generatingReport ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Text style={styles.reportBtnText}>Report</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Ask about the damage..."
              placeholderTextColor="#999"
              onSubmitEditing={() => send()}
              editable={!isGenerating}
            />
            <TouchableOpacity
              onPress={() => send()}
              disabled={!input.trim() || isGenerating}
              style={[
                styles.sendBtn,
                (!input.trim() || isGenerating) && styles.disabled,
              ]}
            >
              <Text style={styles.sendText}>Send</Text>
            </TouchableOpacity>
          </View>
        </BlurView>
      </KeyboardAvoidingView>

      {/* Report Modal */}
      <Modal
        visible={showReport}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowReport(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Inspection Report</Text>
            <TouchableOpacity onPress={() => setShowReport(false)}>
              <Text style={styles.modalClose}>Done</Text>
            </TouchableOpacity>
          </View>

          {report && (
            <ScrollView style={styles.reportScroll} contentContainerStyle={styles.reportContent}>
              <View style={styles.reportCard}>
                <Text style={styles.reportId}>{report.id}</Text>
                <Text style={styles.reportDate}>{report.date} at {report.time}</Text>
              </View>

              <View style={styles.severityCard}>
                <Text style={styles.severityLabel}>SEVERITY</Text>
                <Text style={styles.severityValue}>{report.severity}/10</Text>
              </View>

              <View style={styles.reportSection}>
                <Text style={styles.sectionLabel}>SUMMARY</Text>
                <Text style={styles.sectionText}>{report.summary}</Text>
              </View>

              <View style={styles.reportSection}>
                <Text style={styles.sectionLabel}>DAMAGE DESCRIPTION</Text>
                <Text style={styles.sectionText}>{report.damageDescription}</Text>
              </View>

              <View style={styles.reportSection}>
                <Text style={styles.sectionLabel}>RECOMMENDATIONS</Text>
                <Text style={styles.sectionText}>{report.recommendations}</Text>
              </View>

              {report.images.length > 0 && (
                <View style={styles.reportSection}>
                  <Text style={styles.sectionLabel}>ATTACHED IMAGES ({report.images.length})</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imagesRow}>
                    {report.images.map((uri, idx) => (
                      <Image key={idx} source={{ uri }} style={styles.reportImage} />
                    ))}
                  </ScrollView>
                </View>
              )}

              {report.policyReferences.length > 0 && (
                <View style={styles.reportSection}>
                  <Text style={styles.sectionLabel}>POLICY REFERENCES ({report.policyReferences.length})</Text>
                  {report.policyReferences.map((ref, idx) => (
                    <Text key={idx} style={styles.policyRef}>{ref}</Text>
                  ))}
                </View>
              )}

              <TouchableOpacity onPress={shareReport} style={styles.shareBtn}>
                <Text style={styles.shareBtnText}>Share Report</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F0F0F5" },
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F0F0F5",
    padding: 32,
  },
  loadingCard: {
    borderRadius: 24,
    padding: 40,
    alignItems: "center",
    width: "100%",
    backgroundColor: "rgba(255,255,255,0.7)",
    overflow: "hidden",
  },
  loadingTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#000",
    marginTop: 20,
    marginBottom: 8,
  },
  loadingText: { color: "#888", fontSize: 15 },
  loadingSubtext: { color: "#AAA", fontSize: 13, marginTop: 4 },
  progressBar: {
    width: "100%",
    height: 4,
    backgroundColor: "#E0E0E0",
    borderRadius: 2,
    marginTop: 20,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: "#000", borderRadius: 2 },
  messages: { padding: 16, paddingBottom: 8 },
  messageContainer: { marginVertical: 6, alignSelf: "flex-start" },
  messageContainerUser: { alignSelf: "flex-end", maxWidth: "80%" },
  bubble: { padding: 14, borderRadius: 18 },
  user: { backgroundColor: "#000", alignSelf: "flex-end" },
  bot: { backgroundColor: "rgba(255,255,255,0.9)", alignSelf: "flex-start" },
  bubbleText: { color: "#000", fontSize: 15, lineHeight: 22, flexWrap: "wrap" },
  userText: { color: "#FFF" },
  image: { width: 180, height: 135, borderRadius: 12, marginBottom: 10 },
  searchingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  searchingText: { color: "#666", fontSize: 15, fontStyle: "italic" },

  actionButtonsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  actionButton: {
    backgroundColor: "rgba(0,0,0,0.05)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  actionButtonActive: {
    backgroundColor: "rgba(0,0,0,0.1)",
  },
  actionButtonText: {
    fontSize: 12,
    color: "#666",
    fontWeight: "500",
  },

  reasoningContainer: {
    marginTop: 10,
    backgroundColor: "#FFF",
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  reasoningTab: {
    backgroundColor: "#F5F5F5",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#EEE",
  },
  reasoningTitle: {
    fontSize: 11,
    fontWeight: "600",
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  reasoningContent: {
    padding: 12,
    maxHeight: 200,
  },
  reasoningText: {
    fontSize: 12,
    color: "#555",
    lineHeight: 18,
  },

  sourcesContainer: {
    marginTop: 10,
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  sourcesListTitle: {
    fontSize: 11,
    fontWeight: "600",
    color: "#888",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sourcesList: { gap: 6 },
  sourceItem: {
    backgroundColor: "rgba(0,0,0,0.03)",
    borderRadius: 8,
    padding: 10,
  },
  sourceHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  sourceDocName: { fontSize: 11, fontWeight: "600", color: "#333" },
  sourceScore: {
    fontSize: 10,
    color: "#666",
    fontWeight: "500",
    backgroundColor: "rgba(0,0,0,0.05)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  sourceChunk: { fontSize: 11, color: "#666", lineHeight: 16 },

  inputArea: {
    paddingTop: 12,
    paddingHorizontal: 16,
    backgroundColor: "rgba(255,255,255,0.8)",
    overflow: "hidden",
  },
  buttonRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  actionBtn: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.05)",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
  },
  actionText: { color: "#000", fontSize: 15, fontWeight: "500" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  input: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.05)",
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 12,
    fontSize: 15,
    color: "#000",
  },
  sendBtn: {
    backgroundColor: "#000",
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  disabled: { backgroundColor: "#CCC" },
  sendText: { color: "#FFF", fontSize: 15, fontWeight: "600" },

  // Report button
  reportBtn: {
    backgroundColor: "#007AFF",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 80,
  },
  reportBtnText: { color: "#FFF", fontSize: 15, fontWeight: "600" },

  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: "#F5F5F5",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    paddingTop: 20,
    backgroundColor: "#FFF",
    borderBottomWidth: 1,
    borderBottomColor: "#EEE",
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#000" },
  modalClose: { fontSize: 16, color: "#007AFF", fontWeight: "600" },

  reportScroll: { flex: 1 },
  reportContent: { padding: 16, paddingBottom: 40 },

  reportCard: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    alignItems: "center",
  },
  reportId: { fontSize: 14, fontWeight: "700", color: "#007AFF", marginBottom: 4 },
  reportDate: { fontSize: 13, color: "#888" },

  severityCard: {
    backgroundColor: "#000",
    borderRadius: 16,
    padding: 24,
    marginBottom: 16,
    alignItems: "center",
  },
  severityLabel: { fontSize: 12, fontWeight: "600", color: "#888", marginBottom: 8 },
  severityValue: { fontSize: 48, fontWeight: "800", color: "#FFF" },

  reportSection: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#888",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  sectionText: { fontSize: 15, color: "#333", lineHeight: 22 },

  imagesRow: { marginTop: 8 },
  reportImage: {
    width: 120,
    height: 90,
    borderRadius: 10,
    marginRight: 10,
  },

  policyRef: {
    fontSize: 12,
    color: "#666",
    backgroundColor: "#F5F5F5",
    padding: 10,
    borderRadius: 8,
    marginBottom: 6,
    lineHeight: 18,
  },

  shareBtn: {
    backgroundColor: "#000",
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    marginTop: 16,
  },
  shareBtnText: { color: "#FFF", fontSize: 16, fontWeight: "600" },

  damageCard: {
    backgroundColor: "#F8F8F8",
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
    minWidth: 260,
  },
  damageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
  },
  damageHeaderText: {
    flex: 1,
  },
  severityBadge: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  severityLow: {
    backgroundColor: "#34C759",
  },
  severityMed: {
    backgroundColor: "#FF9500",
  },
  severityHigh: {
    backgroundColor: "#FF3B30",
  },
  severityBadgeText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "700",
  },
  damageType: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000",
    textTransform: "capitalize",
  },
  damageLocation: {
    fontSize: 13,
    color: "#666",
    textTransform: "capitalize",
  },
  damageDescription: {
    fontSize: 14,
    color: "#333",
    lineHeight: 20,
    marginBottom: 10,
  },
  repairEstimate: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.05)",
    borderRadius: 8,
    padding: 10,
    gap: 6,
  },
  repairLabel: {
    fontSize: 12,
    color: "#666",
  },
  repairValue: {
    fontSize: 12,
    fontWeight: "600",
    color: "#000",
    textTransform: "capitalize",
  },

  pdfCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F5F5F5",
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    gap: 12,
  },
  pdfIcon: {
    width: 44,
    height: 44,
    backgroundColor: "#E53935",
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  pdfIconText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "700",
  },
  pdfInfo: {
    flex: 1,
  },
  pdfTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#000",
    marginBottom: 2,
  },
  pdfSubtitle: {
    fontSize: 12,
    color: "#666",
  },
  pdfArrow: {
    fontSize: 24,
    color: "#CCC",
    fontWeight: "300",
  },
});
