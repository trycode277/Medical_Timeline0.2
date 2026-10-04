import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Pressable
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace("/");
            }
          }}
        >
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>

        <View style={styles.logo}>
          <Text style={styles.logoText}>✚</Text>
        </View>

        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>
          Sign in to continue organizing your medical records.
        </Text>

        <View style={styles.form}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your email"
            placeholderTextColor="#94A3B8"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your password"
            placeholderTextColor="#94A3B8"
            secureTextEntry
            autoComplete="password"
            value={password}
            onChangeText={setPassword}
          />

          <Pressable
            style={styles.primaryButton}
            onPress={() =>
              Alert.alert(
                "Sign In",
                "Authentication is not connected yet.",
              )
            }
          >
            <Text style={styles.primaryButtonText}>Sign In</Text>
          </Pressable>

          <Pressable onPress={() => router.push("/register")}>
            <Text style={styles.registerText}>
              Don&apos;t have an account?{" "}
              <Text style={styles.registerBold}>Create one</Text>
            </Text>
          </Pressable>
        </View>
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
  back: {
    fontSize: 17,
    color: "#0F766E",
    fontWeight: "600",
    marginBottom: 20,
  },
  logo: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: "#0F766E",
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "center",
    marginBottom: 18,
  },
  logoText: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "700",
  },
  title: {
    fontSize: 30,
    fontWeight: "800",
    color: "#0F172A",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: "#64748B",
    textAlign: "center",
    marginTop: 10,
    marginBottom: 28,
  },
  form: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  label: {
    fontSize: 14,
    fontWeight: "700",
    color: "#334155",
    marginBottom: 8,
    marginTop: 10,
  },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    paddingHorizontal: 15,
    fontSize: 16,
    color: "#0F172A",
    backgroundColor: "#FFFFFF",
  },
  primaryButton: {
    backgroundColor: "#0F766E",
    borderRadius: 13,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 22,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
  },
  registerText: {
    textAlign: "center",
    color: "#64748B",
    marginTop: 20,
    fontSize: 14,
  },
  registerBold: {
    color: "#0F766E",
    fontWeight: "700",
  },
});
