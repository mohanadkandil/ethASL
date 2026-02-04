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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import { BlurView } from "expo-blur";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CactusLM, type Message as CactusMessage } from "cactus-react-native";

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

type Message = {
  id: string;
  text: string;
  isUser: boolean;
  image?: string;
  sources?: Source[];
  isSearching?: boolean;
  reasoning?: string;
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

  const generateResponse = async (
    text: string,
    imageUri?: string,
    messageId?: string,
  ): Promise<{ response: string; sources: Source[]; reasoning: string }> => {
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
        ? "You are an inspection AI. Analyze the image for damage. Give: 1) Severity (1-10), 2) Description of damage, 3) Recommendations. Be concise and specific."
        : policyContext
          ? `You are an insurance policy assistant. Answer questions using ONLY the policy context below. Be specific and cite section numbers when possible.

POLICY CONTEXT:
${policyContext}`
          : "You are an insurance assistant. Answer questions about insurance policies. If you don't have specific policy information, give general guidance.";

      const messages: CactusMessage[] = [
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
              m.id === messageId ? { ...m, text: clean || "..." } : m,
            ),
          );
        }
      };

      const result = await model.complete({ messages, onToken });
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

    const { response, sources, reasoning } = await generateResponse(
      msg || "Analyze this image for damage.",
      imageUri,
      thinkingId,
    );

    setMessages((prev) =>
      prev.map((m) =>
        m.id === thinkingId
          ? { ...m, text: response, sources, reasoning, isSearching: false }
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
                {!item.isSearching && (
                  <Text
                    style={[styles.bubbleText, item.isUser && styles.userText]}
                  >
                    {item.text}
                  </Text>
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
});
