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
  Image,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import { BlurView } from "expo-blur";
import * as ImagePicker from "expo-image-picker";
import { CactusLM, type Message as CactusMessage } from "cactus-react-native";

type Message = {
  id: string;
  text: string;
  isUser: boolean;
  image?: string;
};

export default function InspectionScreen() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [cactus, setCactus] = useState<CactusLM | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const chatHistoryRef = useRef<CactusMessage[]>([]);

  useEffect(() => {
    loadModel();
    return () => { cactus?.destroy(); };
  }, []);

  const loadModel = async () => {
    try {
      const lm = new CactusLM({
        model: "lfm2-vl-450m",
        options: { quantization: "int4", contextSize: 2048 },
      });

      await lm.download({
        onProgress: (p) => setProgress(Math.round(p * 100)),
      });

      await lm.init();
      setCactus(lm);
      setMessages([{ id: "0", text: "Ready to analyze. Take a photo of the damage.", isUser: false }]);
    } catch (e) {
      setMessages([{ id: "0", text: "Failed to load model.", isUser: false }]);
    } finally {
      setLoading(false);
    }
  };

  const cleanResponse = (text: string): string => {
    return text
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<\|.*?\|>/gi, "")
      .trim();
  };

  const generateResponse = async (text: string, imageUri?: string): Promise<string> => {
    if (!cactus) return "Model not loaded.";

    try {
      const imagePath = imageUri?.replace("file://", "");
      const userMsg = imageUri
        ? { role: "user" as const, content: text, images: [imagePath] }
        : { role: "user" as const, content: text };

      const messages: CactusMessage[] = [
        { role: "system", content: "You are an inspection AI. Analyze images for damage. Give severity (1-10), description, and recommendations. Be concise." },
        ...chatHistoryRef.current,
        userMsg,
      ];

      const result = await cactus.complete({ messages });
      const response = cleanResponse(result.response);

      chatHistoryRef.current = [
        ...chatHistoryRef.current,
        { role: "user", content: text },
        { role: "assistant", content: response },
      ];

      return response;
    } catch (e) {
      return "Error analyzing.";
    }
  };

  const send = async (text?: string, imageUri?: string) => {
    const msg = text || input.trim();
    if ((!msg && !imageUri) || isGenerating) return;

    setMessages((prev) => [...prev, { id: Date.now().toString(), text: msg || "Photo", isUser: true, image: imageUri }]);
    setInput("");
    setIsGenerating(true);
    Keyboard.dismiss();

    const thinkingId = (Date.now() + 1).toString();
    setMessages((prev) => [...prev, { id: thinkingId, text: "Analyzing...", isUser: false }]);

    const response = await generateResponse(msg || "Analyze this image for damage.", imageUri);

    setMessages((prev) => prev.map((m) => (m.id === thinkingId ? { ...m, text: response } : m)));
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
        <Stack.Screen options={{ title: "Inspection", headerBackTitle: "Back" }} />
        <View style={styles.loading}>
          <BlurView intensity={50} tint="light" style={styles.loadingCard}>
            <ActivityIndicator color="#000" size="large" />
            <Text style={styles.loadingTitle}>Loading AI</Text>
            <Text style={styles.loadingText}>{progress > 0 ? `${progress}%` : "Initializing..."}</Text>
            {progress > 0 && (
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${progress}%` }]} />
              </View>
            )}
          </BlurView>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Inspection", headerBackTitle: "Back" }} />
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
            <View style={[styles.bubble, item.isUser ? styles.user : styles.bot]}>
              {item.image && <Image source={{ uri: item.image }} style={styles.image} />}
              <Text style={[styles.bubbleText, item.isUser && styles.userText]}>{item.text}</Text>
            </View>
          )}
        />

        <BlurView intensity={60} tint="light" style={[styles.inputArea, { paddingBottom: insets.bottom || 16 }]}>
          <View style={styles.buttonRow}>
            <TouchableOpacity onPress={() => pickImage(true)} style={styles.actionBtn}>
              <Text style={styles.actionText}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => pickImage(false)} style={styles.actionBtn}>
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
              style={[styles.sendBtn, (!input.trim() || isGenerating) && styles.disabled]}
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
  loading: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F0F0F5", padding: 32 },
  loadingCard: { borderRadius: 24, padding: 40, alignItems: "center", width: "100%", backgroundColor: "rgba(255,255,255,0.7)", overflow: "hidden" },
  loadingTitle: { fontSize: 20, fontWeight: "600", color: "#000", marginTop: 20, marginBottom: 8 },
  loadingText: { color: "#888", fontSize: 15 },
  progressBar: { width: "100%", height: 4, backgroundColor: "#E0E0E0", borderRadius: 2, marginTop: 20, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: "#000", borderRadius: 2 },
  messages: { padding: 16, paddingBottom: 8 },
  bubble: { marginVertical: 6, padding: 14, borderRadius: 18, maxWidth: "80%" },
  user: { backgroundColor: "#000", alignSelf: "flex-end" },
  bot: { backgroundColor: "rgba(255,255,255,0.8)", alignSelf: "flex-start" },
  bubbleText: { color: "#000", fontSize: 15, lineHeight: 22 },
  userText: { color: "#FFF" },
  image: { width: 180, height: 135, borderRadius: 12, marginBottom: 10 },
  inputArea: { paddingTop: 12, paddingHorizontal: 16, backgroundColor: "rgba(255,255,255,0.8)", overflow: "hidden" },
  buttonRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  actionBtn: { flex: 1, backgroundColor: "rgba(0,0,0,0.05)", borderRadius: 12, padding: 14, alignItems: "center" },
  actionText: { color: "#000", fontSize: 15, fontWeight: "500" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  input: { flex: 1, backgroundColor: "rgba(0,0,0,0.05)", borderRadius: 20, paddingHorizontal: 18, paddingVertical: 12, fontSize: 15, color: "#000" },
  sendBtn: { backgroundColor: "#000", borderRadius: 20, paddingHorizontal: 20, paddingVertical: 12 },
  disabled: { backgroundColor: "#CCC" },
  sendText: { color: "#FFF", fontSize: 15, fontWeight: "600" },
});
