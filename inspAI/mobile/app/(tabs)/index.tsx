import { useState, useEffect, useRef } from "react";
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
  TouchableWithoutFeedback,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CactusLM, type Message as CactusMessage } from "cactus-react-native";

type Message = {
  id: string;
  text: string;
  isUser: boolean;
};

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatHistory, setChatHistory] = useState<CactusMessage[]>([]);
  const [input, setInput] = useState("");
  const [cactus, setCactus] = useState<CactusLM | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState("Initializing...");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    loadModel();
    return () => {
      cactus?.destroy();
    };
  }, []);

  const loadModel = async () => {
    try {
      setLoading(true);
      setError(null);
      setLoadingStatus("Initializing...");

      const lm = new CactusLM({
        model: "lfm2.5-1.2b-instruct",
        options: {
          quantization: "int4",
          contextSize: 2048,
        },
      });

      setLoadingStatus("Downloading model...");

      await lm.download({
        onProgress: (progress) => {
          const pct = Math.round(progress * 100);
          setDownloadProgress(pct);
          setLoadingStatus(`Downloading... ${pct}%`);
        },
      });

      setLoadingStatus("Loading model...");
      await lm.init();

      setCactus(lm);
      setMessages([
        {
          id: "0",
          text: "Hello! I'm LFM 1.2B by Liquid AI, running entirely on your device. How can I help you?",
          isUser: false,
        },
      ]);
    } catch (e) {
      console.error("[Cactus] Load error:", e);
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      setMessages([
        {
          id: "0",
          text: `Failed to load: ${errorMsg}`,
          isUser: false,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const cleanResponse = (text: string): string => {
    // Remove <think>...</think> blocks
    let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
    // Remove any remaining model tokens
    cleaned = cleaned.replace(/<\|im_end\|>/gi, '');
    cleaned = cleaned.replace(/<\|im_start\|>/gi, '');
    cleaned = cleaned.replace(/<\|endoftext\|>/gi, '');
    // Trim whitespace
    return cleaned.trim();
  };

  const generateResponse = async (userMessage: string): Promise<string> => {
    if (!cactus) return `Model not loaded.`;

    try {
      const newHistory: CactusMessage[] = [
        ...chatHistory,
        { role: "user", content: userMessage },
      ];

      const result = await cactus.complete({ messages: newHistory });
      const cleanedResponse = cleanResponse(result.response);

      setChatHistory([
        ...newHistory,
        { role: "assistant", content: cleanedResponse },
      ]);

      return cleanedResponse;
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || isGenerating) return;

    const userText = input.trim();
    setMessages((prev) => [...prev, { id: Date.now().toString(), text: userText, isUser: true }]);
    setInput("");
    setIsGenerating(true);
    Keyboard.dismiss();

    const thinkingId = (Date.now() + 1).toString();
    setMessages((prev) => [...prev, { id: thinkingId, text: "Thinking...", isUser: false }]);

    const response = await generateResponse(userText);

    setMessages((prev) =>
      prev.map((msg) => (msg.id === thinkingId ? { ...msg, text: response } : msg))
    );
    setIsGenerating(false);
  };

  const renderMessage = ({ item }: { item: Message }) => (
    <View style={[styles.bubbleRow, item.isUser ? styles.userRow : styles.botRow]}>
      <View style={[styles.bubble, item.isUser ? styles.userBubble : styles.botBubble]}>
        <Text style={[styles.bubbleText, item.isUser ? styles.userText : styles.botText]}>
          {item.text}
        </Text>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { paddingTop: insets.top + 60 }]}>
        <View style={styles.loadingCard}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingTitle}>On-Device AI</Text>
          <Text style={styles.loadingText}>{loadingStatus}</Text>
          {downloadProgress > 0 && downloadProgress < 100 && (
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${downloadProgress}%` }]} />
            </View>
          )}
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
      keyboardVerticalOffset={0}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
          <Text style={styles.headerTitle}>Chat</Text>
          <Text style={styles.headerSubtitle}>LFM 1.2B • On Device</Text>
        </View>
      </TouchableWithoutFeedback>

      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        style={styles.messageList}
        contentContainerStyle={styles.messageListContent}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      />

      <View style={styles.inputBar}>
        <View style={styles.inputRow}>
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Ask anything..."
              placeholderTextColor="#8E8E93"
              onSubmitEditing={sendMessage}
              returnKeyType="send"
              editable={!isGenerating}
              multiline
              maxLength={1000}
            />
          </View>
          <TouchableOpacity
            style={[styles.sendButton, (!cactus || isGenerating || !input.trim()) && styles.sendButtonDisabled]}
            onPress={sendMessage}
            disabled={!cactus || isGenerating || !input.trim()}
          >
            <Text style={styles.sendButtonText}>↑</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F2F2F7",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F2F2F7",
    padding: 32,
  },
  loadingCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    width: "100%",
    maxWidth: 300,
  },
  loadingTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#000",
    marginTop: 16,
  },
  loadingText: {
    color: "#8E8E93",
    marginTop: 8,
    fontSize: 15,
    textAlign: "center",
  },
  progressBar: {
    width: "100%",
    height: 4,
    backgroundColor: "#E5E5EA",
    borderRadius: 2,
    marginTop: 16,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#007AFF",
    borderRadius: 2,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: "#F2F2F7",
  },
  headerTitle: {
    fontSize: 34,
    fontWeight: "700",
    color: "#000",
  },
  headerSubtitle: {
    fontSize: 13,
    color: "#8E8E93",
    marginTop: 2,
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    padding: 16,
  },
  bubbleRow: {
    marginVertical: 4,
  },
  userRow: {
    alignItems: "flex-end",
  },
  botRow: {
    alignItems: "flex-start",
  },
  bubble: {
    padding: 12,
    paddingHorizontal: 16,
    borderRadius: 20,
    maxWidth: "85%",
  },
  userBubble: {
    backgroundColor: "#007AFF",
    borderBottomRightRadius: 6,
  },
  botBubble: {
    backgroundColor: "#FFFFFF",
    borderBottomLeftRadius: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  bubbleText: {
    fontSize: 16,
    lineHeight: 22,
  },
  userText: {
    color: "#FFFFFF",
  },
  botText: {
    color: "#000000",
  },
  inputBar: {
    backgroundColor: "#FFFFFF",
    paddingTop: 12,
    paddingBottom: 100,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(0,0,0,0.15)",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 12,
  },
  inputContainer: {
    flex: 1,
    backgroundColor: "#F2F2F7",
    borderRadius: 20,
    minHeight: 40,
  },
  input: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 17,
    color: "#000",
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: "#007AFF",
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  sendButtonDisabled: {
    backgroundColor: "#D1D1D6",
  },
  sendButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 18,
  },
});
