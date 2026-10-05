import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
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
import { API_BASE_URL } from "@/config/api";

type LoginResponse = {
  access_token: string;
  user: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLoginResponse(value: unknown): value is LoginResponse {
  return (
    isRecord(value) &&
    typeof value.access_token === "string" &&
    isRecord(value.user)
  );
}

function getErrorMessage(value: unknown): string | undefined {
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

function getHttpErrorMessage(status: number, data: unknown): string {
  const detail = getErrorMessage(data);

  if (status === 401) {
    return "Invalid email or password.";
  }

  if (status === 422) {
    return detail ?? "The login request failed validation (HTTP 422).";
  }

  if (status === 503) {
    return detail
      ? `Backend authentication is not configured correctly. ${detail}`
      : "Backend authentication is not configured correctly.";
  }

  return detail
    ? `Request failed with HTTP ${status}. ${detail}`
    : `Request failed with HTTP ${status}.`;
}

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSignIn() {
    if (!email.trim() || !password) {
      Alert.alert("Sign In", "Please enter your email and password.");
      return;
    }

    setIsLoading(true);

    try {
      let response: Response;
      try {
        response = await fetch(`${API_BASE_URL}/api/auth/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            password,
          }),
        });
      } catch {
        Alert.alert(
          "Connection Error",
          "Unable to connect to the backend. Check that your phone and laptop are on the same Wi-Fi.",
        );
        return;
      }

      let responseData: unknown = null;
      try {
        responseData = await response.json();
      } catch {
        responseData = null;
      }

      if (!response.ok) {
        Alert.alert(
          "Sign In Failed",
          getHttpErrorMessage(response.status, responseData),
        );
        return;
      }

      if (!isLoginResponse(responseData)) {
        Alert.alert(
          "Sign In Failed",
          "The backend returned an unexpected response. Please try again.",
        );
        return;
      }

      try {
        await SecureStore.setItemAsync(
          "access_token",
          responseData.access_token,
        );
        await SecureStore.setItemAsync(
          "user",
          JSON.stringify(responseData.user),
        );
      } catch {
        Alert.alert(
          "Sign In Failed",
          "Your session could not be saved securely. Please try again.",
        );
        return;
      }

      router.replace("/explore");
    } finally {
      setIsLoading(false);
    }
  }

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
            onPress={handleSignIn}
            disabled={isLoading}
          >
            <Text style={styles.primaryButtonText}>
              {isLoading ? "Signing in..." : "Sign In"}
            </Text>
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
