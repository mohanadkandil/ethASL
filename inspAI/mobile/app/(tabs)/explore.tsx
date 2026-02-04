import { useState, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import * as DocumentPicker from "expo-document-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";

type Document = {
  id: string;
  name: string;
  chunks: string[];
  embeddings: number[][];
  createdAt: string;
};

const STORAGE_KEY = "inspai_knowledge_base";

// Simple text chunking
const chunkText = (text: string, chunkSize: number = 500): string[] => {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim());
  const chunks: string[] = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > chunkSize && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += (currentChunk ? ". " : "") + sentence.trim();
    }
  }
  if (currentChunk) chunks.push(currentChunk.trim());
  return chunks;
};

export default function KnowledgeBaseScreen() {
  const insets = useSafeAreaInsets();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [docName, setDocName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) setDocuments(JSON.parse(stored));
    } catch (e) {
      console.error("Failed to load documents:", e);
    }
  };

  const saveDocuments = async (docs: Document[]) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
      setDocuments(docs);
    } catch (e) {
      console.error("Failed to save documents:", e);
    }
  };

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "text/*",
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets?.[0]) {
        const file = result.assets[0];
        const response = await fetch(file.uri);
        const text = await response.text();
        setTextInput(text);
        setDocName(file.name.replace(/\.[^/.]+$/, ""));
        setShowAdd(true);
      }
    } catch (e) {
      Alert.alert("Error", "Failed to pick document");
    }
  };

  const handleAddDocument = async () => {
    if (!textInput.trim() || !docName.trim()) {
      Alert.alert("Error", "Please enter document name and content");
      return;
    }

    setLoading(true);

    try {
      const chunks = chunkText(textInput);

      // For now, create placeholder embeddings
      // In production, use Cactus embedding model
      const embeddings = chunks.map(() =>
        Array(384)
          .fill(0)
          .map(() => Math.random()),
      );

      const newDoc: Document = {
        id: Date.now().toString(),
        name: docName.trim(),
        chunks,
        embeddings,
        createdAt: new Date().toLocaleDateString(),
      };

      await saveDocuments([...documents, newDoc]);
      setTextInput("");
      setDocName("");
      setShowAdd(false);
      Alert.alert(
        "Success",
        `Added "${newDoc.name}" with ${chunks.length} chunks`,
      );
    } catch (e) {
      Alert.alert("Error", "Failed to process document");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (id: string) => {
    Alert.alert("Delete", "Remove this document?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => saveDocuments(documents.filter((d) => d.id !== id)),
      },
    ]);
  };

  const addSamplePolicy = async () => {
    const samplePolicy = `
    INSURANCE POLICY DOCUMENT - AUTO COVERAGE

    Section 1: Coverage Overview
    This policy provides comprehensive coverage for vehicle damage, liability, and personal injury protection.

    Section 2: Collision Coverage
    Covers damage to your vehicle from collision with another vehicle or object. Deductible: $500. Maximum coverage: $50,000.

    Section 3: Comprehensive Coverage
    Covers non-collision damage including theft, vandalism, fire, natural disasters, and falling objects. Deductible: $250. Maximum coverage: $50,000.

    Section 4: Liability Coverage
    Bodily injury liability: $100,000 per person, $300,000 per accident. Property damage liability: $50,000 per accident.

    Section 5: Exclusions
    This policy does not cover: Pre-existing damage, intentional damage, damage while under influence, racing or competition use, commercial use without endorsement.

    Section 6: Claims Process
    All claims must include: Date and time of incident, photos of damage (minimum 3), police report number if applicable, witness information. Claims over $5,000 require in-person inspection.

    Section 7: Depreciation
    Actual cash value is determined by fair market value minus depreciation. Vehicles over 10 years old subject to 15% depreciation cap.
    `;

    setTextInput(samplePolicy.trim());
    setDocName("Auto Insurance Policy");
    setShowAdd(true);
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 20, paddingBottom: 120 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Knowledge Base</Text>
        <Text style={styles.subtitle}>Policy documents for RAG retrieval</Text>

        <View style={styles.buttonRow}>
          <TouchableOpacity onPress={handlePickDocument} style={styles.addBtn}>
            <BlurView intensity={50} tint="light" style={styles.addBtnInner}>
              <Text style={styles.addBtnText}>Upload File</Text>
            </BlurView>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setShowAdd(true)}
            style={styles.addBtn}
          >
            <BlurView intensity={50} tint="light" style={styles.addBtnInner}>
              <Text style={styles.addBtnText}>Paste Text</Text>
            </BlurView>
          </TouchableOpacity>
        </View>

        {documents.length === 0 && (
          <TouchableOpacity onPress={addSamplePolicy} style={styles.sampleBtn}>
            <Text style={styles.sampleBtnText}>Add Sample Policy</Text>
          </TouchableOpacity>
        )}

        {showAdd && (
          <BlurView intensity={40} tint="light" style={styles.addForm}>
            <TextInput
              style={styles.nameInput}
              value={docName}
              onChangeText={setDocName}
              placeholder="Document name..."
              placeholderTextColor="#999"
            />
            <TextInput
              style={styles.textArea}
              value={textInput}
              onChangeText={setTextInput}
              placeholder="Paste policy text here..."
              placeholderTextColor="#999"
              multiline
              textAlignVertical="top"
            />
            <View style={styles.formButtons}>
              <TouchableOpacity
                onPress={() => setShowAdd(false)}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleAddDocument}
                style={styles.saveBtn}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.saveText}>Add Document</Text>
                )}
              </TouchableOpacity>
            </View>
          </BlurView>
        )}

        {/* Documents List */}
        {documents.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Stored Documents</Text>
            {documents.map((doc) => (
              <TouchableOpacity
                key={doc.id}
                style={styles.docCard}
                onLongPress={() => handleDelete(doc.id)}
              >
                <BlurView
                  intensity={40}
                  tint="light"
                  style={styles.docCardInner}
                >
                  <View style={styles.docInfo}>
                    <Text style={styles.docName}>{doc.name}</Text>
                    <Text style={styles.docMeta}>
                      {doc.chunks.length} chunks · {doc.createdAt}
                    </Text>
                  </View>
                  <Text style={styles.docStatus}>Ready</Text>
                </BlurView>
              </TouchableOpacity>
            ))}
            <Text style={styles.hint}>Long press to delete</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F0F0F5" },
  content: { paddingHorizontal: 20 },
  title: { fontSize: 38, fontWeight: "700", color: "#000", marginBottom: 4 },
  subtitle: { fontSize: 15, color: "#888", marginBottom: 24 },
  buttonRow: { flexDirection: "row", gap: 12, marginBottom: 16 },
  addBtn: { flex: 1, borderRadius: 14, overflow: "hidden" },
  addBtnInner: {
    padding: 16,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  addBtnText: { fontSize: 15, fontWeight: "600", color: "#000" },
  sampleBtn: {
    backgroundColor: "#000",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    marginBottom: 24,
  },
  sampleBtnText: { color: "#FFF", fontSize: 15, fontWeight: "600" },
  addForm: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    backgroundColor: "rgba(255,255,255,0.6)",
    overflow: "hidden",
  },
  nameInput: {
    backgroundColor: "rgba(0,0,0,0.05)",
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    color: "#000",
    marginBottom: 12,
  },
  textArea: {
    backgroundColor: "rgba(0,0,0,0.05)",
    borderRadius: 10,
    padding: 14,
    fontSize: 14,
    color: "#000",
    height: 200,
    marginBottom: 12,
  },
  formButtons: { flexDirection: "row", gap: 12 },
  cancelBtn: {
    flex: 1,
    padding: 14,
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.05)",
    borderRadius: 10,
  },
  cancelText: { fontSize: 15, color: "#666" },
  saveBtn: {
    flex: 1,
    padding: 14,
    alignItems: "center",
    backgroundColor: "#000",
    borderRadius: 10,
  },
  saveText: { fontSize: 15, fontWeight: "600", color: "#FFF" },
  section: { marginTop: 8 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  docCard: { borderRadius: 14, overflow: "hidden", marginBottom: 10 },
  docCardInner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  docInfo: { flex: 1 },
  docName: { fontSize: 16, fontWeight: "600", color: "#000", marginBottom: 4 },
  docMeta: { fontSize: 13, color: "#888" },
  docStatus: { fontSize: 13, color: "#34C759", fontWeight: "500" },
  hint: { fontSize: 12, color: "#AAA", textAlign: "center", marginTop: 8 },
});
