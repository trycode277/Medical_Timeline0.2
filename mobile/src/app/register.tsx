import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  View,
  Pressable,
  SafeAreaView,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { useState } from "react";
import { API_BASE_URL } from "@/config/api";

type AccountType = "patient" | "caregiver" | "clinician";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getBackendErrorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const detail = value.detail;
  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) =>
        isRecord(item) && typeof item.msg === "string" ? item.msg : undefined,
      )
      .filter((message): message is string => message !== undefined);

    if (messages.length > 0) {
      return messages.join("\n");
    }
  }

  return undefined;
}

export default function RegisterScreen() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("patient");
  const [isLoading, setIsLoading] = useState(false);

  async function handleRegister() {
    const fullName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();

    if (!fullName) {
      Alert.alert("Create Account", "Please enter your full name.");
      return;
    }

    if (!normalizedEmail) {
      Alert.alert("Create Account", "Please enter your email address.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      Alert.alert("Create Account", "Please enter a valid email address.");
      return;
    }

    if (!password) {
      Alert.alert("Create Account", "Please enter a password.");
      return;
    }

    setIsLoading(true);

    try {
      let response: Response;
      try {
        response = await fetch(`${API_BASE_URL}/api/auth/register`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            full_name: fullName,
            email: normalizedEmail,
            password,
            account_type: accountType,
          }),
        });
      } catch {
        Alert.alert(
          "Connection Error",
          "Your phone cannot connect to the backend. Make sure your phone and laptop are connected to the same Wi-Fi network.",
        );
        return;
      }

      const responseData: unknown = await response.json().catch(() => null);

      if (response.status === 409) {
        Alert.alert(
          "Create Account",
          "An account with this email already exists.",
        );
        return;
      }

      if (!response.ok) {
        Alert.alert(
          "Registration Failed",
          getBackendErrorMessage(responseData) ??
            "Unable to create your account. Please check your details and try again.",
        );
        return;
      }

      Alert.alert(
        "Account Created",
        "Account created successfully. Please sign in.",
        [{ text: "Sign In", onPress: () => router.replace("/login") }],
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
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

        <Text style={styles.title}>Create your account</Text>

        <Text style={styles.subtitle}>
          Create an account to securely organize your medical records.
        </Text>

        <View style={styles.form}>
          <Text style={styles.label}>Full Name</Text>

          <TextInput
            style={styles.input}
            placeholder="Enter your full name"
            placeholderTextColor="#94A3B8"
            value={name}
            onChangeText={setName}
          />

          <Text style={styles.label}>Email</Text>

          <TextInput
            style={styles.input}
            placeholder="Enter your email"
            placeholderTextColor="#94A3B8"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />

          <Text style={styles.label}>Password</Text>

          <TextInput
            style={styles.input}
            placeholder="Create a password"
            placeholderTextColor="#94A3B8"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <Text style={styles.label}>Account type</Text>

          <View style={styles.roleRow}>
            <Pressable
              style={[
                styles.roleButton,
                accountType === "patient" && styles.selectedRoleButton,
              ]}
              onPress={() => setAccountType("patient")}
              accessibilityRole="radio"
              accessibilityState={{ selected: accountType === "patient" }}
            >
              <Text style={styles.roleText}>Patient</Text>
            </Pressable>

            <Pressable
              style={[
                styles.roleButton,
                accountType === "caregiver" && styles.selectedRoleButton,
              ]}
              onPress={() => setAccountType("caregiver")}
              accessibilityRole="radio"
              accessibilityState={{ selected: accountType === "caregiver" }}
            >
              <Text style={styles.roleText}>Caregiver</Text>
            </Pressable>

            <Pressable
              style={[
                styles.roleButton,
                accountType === "clinician" && styles.selectedRoleButton,
              ]}
              onPress={() => setAccountType("clinician")}
              accessibilityRole="radio"
              accessibilityState={{ selected: accountType === "clinician" }}
            >
              <Text style={styles.roleText}>Clinician</Text>
            </Pressable>
          </View>

          <Pressable
            style={styles.registerButton}
            onPress={handleRegister}
            disabled={isLoading}
          >
            <Text style={styles.registerButtonText}>
              {isLoading ? "Creating account..." : "Create Account"}
            </Text>
          </Pressable>

          <Pressable onPress={() => router.push("/login")}>
            <Text style={styles.signInText}>
              Already have an account?{" "}
              <Text style={styles.signInBold}>Sign In</Text>
            </Text>
          </Pressable>
        </View>

        <Text style={styles.disclaimer}>
          Your information will be handled securely.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },

  content: {
    paddingHorizontal: 28,
    paddingVertical: 20,
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

  roleRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 22,
  },

  roleButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },

  selectedRoleButton: {
    borderColor: "#0F766E",
    backgroundColor: "#F0FDFA",
  },

  roleText: {
    color: "#475569",
    fontWeight: "600",
    fontSize: 13,
  },

  registerButton: {
    backgroundColor: "#0F766E",
    borderRadius: 13,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },

  registerButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
  },

  signInText: {
    textAlign: "center",
    color: "#64748B",
    marginTop: 20,
    fontSize: 14,
  },

  signInBold: {
    color: "#0F766E",
    fontWeight: "700",
  },

  disclaimer: {
    textAlign: "center",
    color: "#94A3B8",
    fontSize: 11,
    marginTop: 20,
  },
});