import { useRouter } from "expo-router";
import { StyleSheet, Text, View, Pressable, SafeAreaView } from "react-native";

export default function HomeScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>✚</Text>
        </View>

        <Text style={styles.title}>Medical Timeline</Text>

        <Text style={styles.subtitle}>
          Your medical records, organized into a simple timeline.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Welcome 👋</Text>

          <Text style={styles.cardText}>
            Upload your medical records and let AI organize visits, tests,
            diagnoses and medications into one clear timeline.
          </Text>
        </View>

        <Pressable
          style={styles.primaryButton}
          onPress={() => router.push("/register")}
        >
          <Text style={styles.primaryButtonText}>Get Started</Text>
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={() => router.push("/login")}
        >
          <Text style={styles.secondaryButtonText}>Sign In</Text>
        </Pressable>

        <Text style={styles.disclaimer}>
          For informational organization only. Not medical advice.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },

  content: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
  },

  logo: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: "#0F766E",
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "center",
    marginBottom: 22,
  },

  logoText: {
    color: "#FFFFFF",
    fontSize: 38,
    fontWeight: "700",
  },

  title: {
    fontSize: 34,
    fontWeight: "800",
    color: "#0F172A",
    textAlign: "center",
  },

  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: "#64748B",
    textAlign: "center",
    marginTop: 12,
    marginBottom: 30,
  },

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 24,
  },

  cardTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#0F172A",
    marginBottom: 10,
  },

  cardText: {
    fontSize: 15,
    lineHeight: 23,
    color: "#475569",
  },

  primaryButton: {
    backgroundColor: "#0F766E",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    marginBottom: 12,
  },

  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
  },

  secondaryButton: {
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
  },

  secondaryButtonText: {
    color: "#0F766E",
    fontSize: 17,
    fontWeight: "700",
  },

  disclaimer: {
    textAlign: "center",
    color: "#94A3B8",
    fontSize: 11,
    marginTop: 24,
    lineHeight: 17,
  },
});