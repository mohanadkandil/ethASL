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
} from "react-native";
import { CactusLM, type Message as CactusMessage } from "cactus-react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useThemeColor } from "@/hooks/use-theme-color";

type Message = {
  id: string;
  text: string;
  isUser: boolean;
};

export default function ChatScreen() {
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

  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");

  useEffect(() => {
    loadModel();
    return () => {
      // Cleanup on unmount
      cactus?.destroy();
    };
  }, []);

  const loadModel = async () => {
    try {
      setLoading(true);
      setError(null);
      setLoadingStatus("Initializing Cactus...");

      const lm = new CactusLM({
        model: "qwen3-0.6b",
        options: {
          quantization: "int4",
          contextSize: 2048,
        },
      });

      setLoadingStatus("Downloading model...\nThis may take a few minutes on first run.");

      await lm.download({
        onProgress: (progress) => {
          const pct = Math.round(progress * 100);
          setDownloadProgress(pct);
          setLoadingStatus(`Downloading model... ${pct}%`);
        },
      });

      setLoadingStatus("Initializing model...\nThis may take a moment.");
      console.log("[Cactus] Starting init...");

      try {
        await lm.init();
        console.log("[Cactus] Init complete!");
      } catch (initError) {
        console.error("[Cactus] Init failed:", initError);
        throw initError;
      }

      setCactus(lm);
      setMessages([
        {
          id: "0",
          text: "Qwen3-0.6B loaded! Running entirely on your device.\n\nTry asking me something!",
          isUser: false,
        },
      ]);
    } catch (e) {
      console.error("[Cactus] Load error:", e);
      const errorMsg = e instanceof Error
        ? `${e.name}: ${e.message}`
        : String(e);
      setError(errorMsg);
      setMessages([
        {
          id: "0",
          text: `Failed to load model: ${errorMsg}\n\nTip: Try running on a real device instead of simulator.`,
          isUser: false,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const generateResponse = async (userMessage: string): Promise<string> => {
    if (!cactus) {
      return `Model not loaded. Error: ${error || "Unknown"}`;
    }

    try {
      // Add user message to history
      const newHistory: CactusMessage[] = [
        ...chatHistory,
        { role: "user", content: userMessage },
      ];

      const result = await cactus.complete({
        messages: newHistory,
      });

      // Update history with assistant response
      setChatHistory([
        ...newHistory,
        { role: "assistant", content: result.response },
      ]);

      return result.response;
    } catch (e) {
      console.error("[Cactus] Generation error:", e);
      const errorMsg = e instanceof Error ? e.message : String(e);
      return `Generation error: ${errorMsg}`;
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || isGenerating) return;

    const userText = input.trim();
    const userMessage: Message = {
      id: Date.now().toString(),
      text: userText,
      isUser: true,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsGenerating(true);

    // Add thinking indicator
    const thinkingId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      { id: thinkingId, text: "Thinking...", isUser: false },
    ]);

    const response = await generateResponse(userText);

    // Replace thinking with actual response
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === thinkingId ? { ...msg, text: response } : msg
      )
    );
    setIsGenerating(false);
  };

  const renderMessage = ({ item }: { item: Message }) => (
    <View
      style={[
        styles.messageContainer,
        item.isUser ? styles.userMessage : styles.botMessage,
      ]}
    >
      <ThemedText style={item.isUser ? styles.userText : undefined}>
        {item.text}
      </ThemedText>
    </View>
  );

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
        <ThemedText style={styles.loadingText}>{loadingStatus}</ThemedText>
        {downloadProgress > 0 && downloadProgress < 100 && (
          <View style={styles.progressBar}>
            <View
              style={[styles.progressFill, { width: `${downloadProgress}%` }]}
            />
          </View>
        )}
      </ThemedView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={90}
    >
      <ThemedView style={styles.header}>
        <ThemedText type="title">On-Device Chat</ThemedText>
        <ThemedText type="default" style={styles.subtitle}>
          Qwen3-0.6B on device
        </ThemedText>
      </ThemedView>

      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        style={styles.messageList}
        contentContainerStyle={styles.messageListContent}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
      />

      <ThemedView style={styles.inputContainer}>
        <TextInput
          style={[styles.input, { color: textColor, borderColor: textColor }]}
          value={input}
          onChangeText={setInput}
          placeholder="Type a message..."
          placeholderTextColor="#888"
          onSubmitEditing={sendMessage}
          returnKeyType="send"
          editable={!isGenerating}
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            (!cactus || isGenerating) && styles.sendButtonDisabled,
          ]}
          onPress={sendMessage}
          disabled={!cactus || isGenerating}
        >
          <ThemedText style={styles.sendButtonText}>
            {isGenerating ? "..." : "Send"}
          </ThemedText>
        </TouchableOpacity>
      </ThemedView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    padding: 32,
  },
  loadingText: {
    marginTop: 8,
    textAlign: "center",
  },
  progressBar: {
    width: "80%",
    height: 8,
    backgroundColor: "#333",
    borderRadius: 4,
    marginTop: 16,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#007AFF",
  },
  header: {
    padding: 16,
    paddingTop: 60,
    borderBottomWidth: 1,
    borderBottomColor: "#333",
  },
  subtitle: {
    opacity: 0.7,
    marginTop: 4,
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    padding: 16,
    gap: 12,
  },
  messageContainer: {
    padding: 12,
    borderRadius: 16,
    maxWidth: "80%",
  },
  userMessage: {
    backgroundColor: "#007AFF",
    alignSelf: "flex-end",
    borderBottomRightRadius: 4,
  },
  botMessage: {
    backgroundColor: "#333",
    alignSelf: "flex-start",
    borderBottomLeftRadius: 4,
  },
  userText: {
    color: "#fff",
  },
  inputContainer: {
    flexDirection: "row",
    padding: 16,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: "#333",
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
  },
  sendButton: {
    backgroundColor: "#007AFF",
    borderRadius: 24,
    paddingHorizontal: 20,
    justifyContent: "center",
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
});
