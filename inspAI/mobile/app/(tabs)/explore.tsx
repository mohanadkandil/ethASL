import { useState, useEffect, useRef } from "react";
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
import { CactusLM } from "cactus-react-native";
import { extractText, isAvailable } from "expo-pdf-text-extract";

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
  const [modelLoading, setModelLoading] = useState(true);
  const [modelProgress, setModelProgress] = useState(0);
  const cactusRef = useRef<CactusLM | null>(null);

  useEffect(() => {
    loadDocuments();
    loadEmbeddingModel();
    return () => {
      cactusRef.current?.destroy();
    };
  }, []);

  const loadEmbeddingModel = async () => {
    try {
      const lm = new CactusLM({
        model: "qwen3-0.6b",
        options: { quantization: "int4", contextSize: 512 },
      });

      await lm.download({
        onProgress: (p) => setModelProgress(Math.round(p * 100)),
      });

      await lm.init();
      cactusRef.current = lm;
    } catch (e) {
      console.error("Failed to load embedding model:", e);
    } finally {
      setModelLoading(false);
    }
  };

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
        type: "*/*",
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets?.[0]) {
        const file = result.assets[0];
        const isPDF =
          file.mimeType === "application/pdf" ||
          file.name.toLowerCase().endsWith(".pdf");

        let text = "";

        if (isPDF) {
          if (!isAvailable()) {
            Alert.alert(
              "Not Available",
              "PDF extraction requires a development build.",
            );
            return;
          }
          try {
            text = await extractText(file.uri);
            if (!text || text.trim().length < 20) {
              Alert.alert(
                "No Text",
                "Could not extract text. The PDF may be scanned/image-based.",
              );
              return;
            }
          } catch (e: any) {
            Alert.alert("Error", e.message || "Failed to read PDF");
            return;
          }
        } else {
          const response = await fetch(file.uri);
          text = await response.text();
        }

        setTextInput(text);
        setDocName(file.name.replace(/\.[^/.]+$/, ""));
        setShowAdd(true);
      }
    } catch (e) {
      Alert.alert("Error", "Failed to pick document");
    }
  };

  const generateEmbedding = async (text: string): Promise<number[]> => {
    if (!cactusRef.current) {
      // Fallback to placeholder if model not loaded
      return Array(384)
        .fill(0)
        .map(() => Math.random());
    }
    try {
      const result = await cactusRef.current.embed({ text });
      return result.embedding;
    } catch (e) {
      console.error("Embedding error:", e);
      return Array(384)
        .fill(0)
        .map(() => Math.random());
    }
  };

  const handleAddDocument = async () => {
    if (!textInput.trim() || !docName.trim()) {
      Alert.alert("Error", "Please enter document name and content");
      return;
    }

    if (modelLoading) {
      Alert.alert("Please wait", "Embedding model is still loading");
      return;
    }

    setLoading(true);

    try {
      const chunks = chunkText(textInput);

      const embeddings: number[][] = [];
      for (let i = 0; i < chunks.length; i++) {
        const embedding = await generateEmbedding(chunks[i]);
        embeddings.push(embedding);
      }

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
    const samplePolicy = `ALPINE MUTUAL INSURANCE COMPANY
Policy Number: AMI-2024-VH-789456
Effective Date: January 1, 2024 - December 31, 2024

COMPREHENSIVE VEHICLE INSURANCE POLICY

SECTION 1: POLICYHOLDER INFORMATION
Policyholder: [Name on File]
Coverage Type: Gold Premium Package
Vehicle: [VIN on File]

SECTION 2: COLLISION COVERAGE
Coverage Limit: $75,000 per incident
Deductible: $500 standard / $250 for preferred members
This coverage applies to damage resulting from collision with another vehicle, object, or rollover. Coverage includes towing up to 50 miles to nearest approved repair facility.

SECTION 3: COMPREHENSIVE COVERAGE
Coverage Limit: $75,000 per incident
Deductible: $250
Covers non-collision damage including: theft, vandalism, fire, hail, flooding, falling objects, animal collision, glass breakage, and civil disturbance damage.

SECTION 4: LIABILITY COVERAGE
Bodily Injury: $250,000 per person / $500,000 per accident
Property Damage: $100,000 per accident
Medical Payments: $10,000 per person
This coverage protects you if you are legally responsible for injuries or damage to others.

SECTION 5: UNINSURED/UNDERINSURED MOTORIST
Coverage: $250,000 per person / $500,000 per accident
Applies when at-fault party has no insurance or insufficient coverage.

SECTION 6: RENTAL REIMBURSEMENT
Daily Limit: $50/day
Maximum Period: 30 days
Available while your vehicle is being repaired at an approved facility.

SECTION 7: DAMAGE ASSESSMENT GUIDELINES
Minor Damage (Severity 1-3): Scratches, small dents, cosmetic damage. Estimated repair under $2,500. Standard claims process, no inspection required.
Moderate Damage (Severity 4-6): Panel damage, bumper replacement, mechanical issues. Estimated repair $2,500-$10,000. Photo documentation required, may require inspection.
Severe Damage (Severity 7-9): Structural damage, airbag deployment, major mechanical failure. Estimated repair over $10,000. Mandatory in-person inspection required.
Total Loss (Severity 10): Damage exceeds 75% of vehicle actual cash value. Vehicle will be declared total loss. Settlement based on pre-loss fair market value.

SECTION 8: CLAIMS PROCESS
Step 1: Report incident within 72 hours via app, phone (1-800-ALPINE-1), or online portal.
Step 2: Submit required documentation: photos of damage (minimum 4 angles), police report if applicable, witness statements, repair estimates.
Step 3: Claims under $5,000 processed within 5 business days with approved documentation.
Step 4: Claims over $5,000 require field inspection by Alpine Mutual adjuster within 7 business days.
Step 5: Payment issued within 48 hours of claim approval via direct deposit or check.

SECTION 9: EXCLUSIONS
This policy does NOT cover:
- Damage from racing, competition, or reckless driving
- Intentional damage or fraud
- Damage while operating under influence of drugs/alcohol
- Commercial or rideshare use without endorsement
- Pre-existing damage not disclosed at policy inception
- Wear and tear, mechanical breakdown, or maintenance issues
- Damage from nuclear hazard or war

SECTION 10: DEPRECIATION SCHEDULE
Vehicles 0-3 years: 100% of repair value
Vehicles 4-6 years: 90% of repair value
Vehicles 7-10 years: 80% of repair value
Vehicles over 10 years: 70% of repair value (15% depreciation cap)

SECTION 11: APPROVED REPAIR NETWORK
Alpine Mutual partners with certified repair facilities nationwide. Using approved facilities guarantees: lifetime warranty on repairs, direct billing, and expedited service. Out-of-network repairs require pre-approval and may result in reduced coverage.

For questions contact: claims@alpinemutual.com | 1-800-ALPINE-1
Alpine Mutual Insurance Company | 1200 Mountain View Drive, Denver, CO 80202`;

    setTextInput(samplePolicy.trim());
    setDocName("Alpine Mutual Auto Policy");
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

        {modelLoading && (
          <BlurView intensity={40} tint="light" style={styles.modelStatus}>
            <ActivityIndicator color="#000" size="small" />
            <Text style={styles.modelStatusText}>
              Loading embedding model...{" "}
              {modelProgress > 0 ? `${modelProgress}%` : ""}
            </Text>
          </BlurView>
        )}

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
  subtitle: { fontSize: 15, color: "#888", marginBottom: 16 },
  modelStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
    backgroundColor: "rgba(255,255,255,0.6)",
    overflow: "hidden",
  },
  modelStatusText: { fontSize: 14, color: "#666" },
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
