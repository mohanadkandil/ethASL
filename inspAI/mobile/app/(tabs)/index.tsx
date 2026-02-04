import { StyleSheet, View, Text, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { BlurView } from "expo-blur";

export default function HomeScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <View style={[styles.content, { paddingTop: insets.top + 60 }]}>
        <Text style={styles.title}>inspAI</Text>
        <Text style={styles.subtitle}>On-device vision AI for field inspection</Text>

        <TouchableOpacity
          onPress={() => router.push("/inspection/new")}
          activeOpacity={0.8}
          style={styles.buttonWrapper}
        >
          <BlurView intensity={60} tint="light" style={styles.button}>
            <Text style={styles.buttonText}>New Inspection</Text>
            <Text style={styles.buttonArrow}>→</Text>
          </BlurView>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F0F0F5",
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 42,
    fontWeight: "700",
    color: "#000",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 17,
    color: "#666",
    marginBottom: 48,
  },
  buttonWrapper: {
    borderRadius: 20,
    overflow: "hidden",
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 24,
    backgroundColor: "rgba(255,255,255,0.7)",
  },
  buttonText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#000",
  },
  buttonArrow: {
    fontSize: 20,
    color: "#999",
  },
});
