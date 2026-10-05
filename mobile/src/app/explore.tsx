import { useRouter } from "expo-router";
import { File } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { API_BASE_URL } from "@/config/api";

type StoredUser = {
  full_name?: string;
  email?: string;
  account_type?: string;
};

type MedicalRecord = {
  id: string;
  original_filename: string;
  status: string;
  uploaded_at: string;
  processed_at?: string | null;
  error_message?: string | null;
};

type MedicalEvent = {
  id: string;
  record_id: string | null;
  event_type: string;
  event_date: string;
  title: string | null;
  description: string;
  provider: string | null;
  source_page: number | null;
  confidence: number | null;
};

type EventCategory =
  | "All"
  | "Visits"
  | "Tests"
  | "Diagnoses"
  | "Treatments"
  | "Medications";

type TimelineGroup = {
  key: string;
  label: string;
  events: MedicalEvent[];
};

const EVENT_CATEGORIES: EventCategory[] = [
  "All",
  "Visits",
  "Tests",
  "Diagnoses",
  "Treatments",
  "Medications",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMedicalRecord(value: unknown): value is MedicalRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.original_filename === "string" &&
    typeof value.status === "string" &&
    typeof value.uploaded_at === "string" &&
    (value.processed_at === undefined ||
      value.processed_at === null ||
      typeof value.processed_at === "string") &&
    (value.error_message === undefined ||
      value.error_message === null ||
      typeof value.error_message === "string")
  );
}

function isMedicalEvent(value: unknown): value is MedicalEvent {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (typeof value.record_id === "string" || value.record_id === null) &&
    typeof value.event_type === "string" &&
    typeof value.event_date === "string" &&
    (typeof value.title === "string" || value.title === null) &&
    typeof value.description === "string" &&
    (typeof value.provider === "string" || value.provider === null) &&
    (typeof value.source_page === "number" || value.source_page === null) &&
    (typeof value.confidence === "number" || value.confidence === null)
  );
}

function isMedicalEventPage(
  value: unknown,
): value is { items: MedicalEvent[] } {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isMedicalEvent)
  );
}

function getRecordStatusLabel(status: string): string {
  switch (status.toLowerCase()) {
    case "pending":
    case "processing":
      return "Processing";
    case "completed":
      return "Completed";
    case "failed":
      return "Processing failed";
    default:
      return "Processing";
  }
}

function formatEventType(eventType: string): string {
  return eventType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatEventDate(value: string): string {
  const dateKey = getEventDateKey(value);
  if (!dateKey) {
    return "Date unavailable";
  }
  const date = new Date(`${dateKey}T00:00:00`);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function getEventDateKey(value: string): string | null {
  const dateKey = value.trim().slice(0, 10);
  return isValidISODate(dateKey) ? dateKey : null;
}

function getEventCategory(eventType: string): EventCategory | null {
  const normalized = eventType.toLowerCase().replace(/[^a-z]/g, "");
  if (normalized.includes("visit") || normalized.includes("appointment")) {
    return "Visits";
  }
  if (normalized.includes("test") || normalized.includes("lab")) {
    return "Tests";
  }
  if (normalized.includes("diagnos") || normalized.includes("condition")) {
    return "Diagnoses";
  }
  if (normalized.includes("treatment") || normalized.includes("procedure")) {
    return "Treatments";
  }
  if (
    normalized.includes("medication") ||
    normalized.includes("prescription") ||
    normalized.includes("drug")
  ) {
    return "Medications";
  }
  return null;
}

function getEventCategoryStyle(eventType: string) {
  switch (getEventCategory(eventType)) {
    case "Visits":
      return mobileStyles.eventTypeVisit;
    case "Tests":
      return mobileStyles.eventTypeTest;
    case "Diagnoses":
      return mobileStyles.eventTypeDiagnosis;
    case "Treatments":
      return mobileStyles.eventTypeTreatment;
    case "Medications":
      return mobileStyles.eventTypeMedication;
    default:
      return mobileStyles.eventTypeOther;
  }
}

function formatMonthYear(value: string): string {
  const dateKey = getEventDateKey(value);
  if (!dateKey) {
    return "Date unavailable";
  }
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function formatRecordDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleString();
}

function parseStoredUser(value: string): StoredUser | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  return {
    full_name:
      typeof parsed.full_name === "string" ? parsed.full_name : undefined,
    email: typeof parsed.email === "string" ? parsed.email : undefined,
    account_type:
      typeof parsed.account_type === "string"
        ? parsed.account_type
        : undefined,
  };
}

function getDocumentType(file: File): string | undefined {
  const mimeType = file.type?.toLowerCase();
  if (mimeType === "application/pdf") {
    return "PDF";
  }
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
    return "JPG";
  }
  if (mimeType === "image/png") {
    return "PNG";
  }
  if (
    mimeType &&
    mimeType !== "application/octet-stream"
  ) {
    return undefined;
  }

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "pdf") {
    return "PDF";
  }
  if (extension === "jpg" || extension === "jpeg") {
    return "JPG";
  }
  if (extension === "png") {
    return "PNG";
  }

  return undefined;
}

function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getBackendDetail(data: unknown): string | undefined {
  if (!isRecord(data)) {
    return undefined;
  }

  if (typeof data.detail === "string") {
    return data.detail;
  }

  if (Array.isArray(data.detail)) {
    const messages = data.detail
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

function getUploadedRecordDetails(data: unknown): string | undefined {
  if (!Array.isArray(data)) {
    return undefined;
  }

  const details = data
    .filter(isRecord)
    .map((record) => {
      const filename =
        typeof record.original_filename === "string"
          ? record.original_filename
          : undefined;
      const status =
        typeof record.status === "string" ? record.status : undefined;

      if (filename && status) {
        return `${filename} — ${status}`;
      }
      return filename ?? status;
    })
    .filter((detail): detail is string => detail !== undefined);

  return details.length > 0 ? details.join("\n") : undefined;
}

export default function ExploreScreen() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [selectedDocument, setSelectedDocument] =
    useState<File | null>(null);
  const [selectedDocumentType, setSelectedDocumentType] = useState<
    string | null
  >(null);
  const [isUploading, setIsUploading] = useState(false);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [isRecordsLoading, setIsRecordsLoading] = useState(false);
  const [hasLoadedRecords, setHasLoadedRecords] = useState(false);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [medicalEvents, setMedicalEvents] = useState<MedicalEvent[]>([]);
  const [isEventsLoading, setIsEventsLoading] = useState(false);
  const [hasLoadedEvents, setHasLoadedEvents] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] =
    useState<EventCategory>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [isFilterSheetVisible, setIsFilterSheetVisible] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("oldest");
  const [draftFromDate, setDraftFromDate] = useState("");
  const [draftToDate, setDraftToDate] = useState("");
  const [draftSortOrder, setDraftSortOrder] =
    useState<"newest" | "oldest">("oldest");
  const [filterValidationError, setFilterValidationError] = useState<
    string | null
  >(null);
  const isUploadInProgress = useRef(false);

  const eventTypeCounts = useMemo(
    () => ({
      tests: medicalEvents.filter(
        (event) => getEventCategory(event.event_type) === "Tests",
      ).length,
      visits: medicalEvents.filter(
        (event) => getEventCategory(event.event_type) === "Visits",
      ).length,
    }),
    [medicalEvents],
  );

  const filteredMedicalEvents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return medicalEvents
      .filter((event) => {
        const eventCategory = getEventCategory(event.event_type);
        if (selectedCategory !== "All" && eventCategory !== selectedCategory) {
          return false;
        }

        const searchableText = [
          event.title ?? "",
          event.description,
          event.provider ?? "",
          event.event_type,
        ]
          .join(" ")
          .toLowerCase();
        if (query && !searchableText.includes(query)) {
          return false;
        }

        const eventDateKey = getEventDateKey(event.event_date);
        if (
          (fromDate || toDate) &&
          (!eventDateKey ||
            (fromDate && eventDateKey < fromDate) ||
            (toDate && eventDateKey > toDate))
        ) {
          return false;
        }

        return true;
      })
      .sort((first, second) => {
        const firstDate = getEventDateKey(first.event_date);
        const secondDate = getEventDateKey(second.event_date);
        if (!firstDate || !secondDate) {
          if (firstDate) return -1;
          if (secondDate) return 1;
          return 0;
        }
        return sortOrder === "oldest"
          ? firstDate.localeCompare(secondDate)
          : secondDate.localeCompare(firstDate);
      });
  }, [medicalEvents, searchQuery, selectedCategory, fromDate, toDate, sortOrder]);

  const timelineGroups = useMemo(() => {
    const groups = new Map<string, TimelineGroup>();
    for (const event of filteredMedicalEvents) {
      const dateKey = getEventDateKey(event.event_date);
      const groupKey = dateKey ? dateKey.slice(0, 7) : "date-unavailable";
      const existingGroup = groups.get(groupKey);
      if (existingGroup) {
        existingGroup.events.push(event);
      } else {
        groups.set(groupKey, {
          key: groupKey,
          label: formatMonthYear(event.event_date),
          events: [event],
        });
      }
    }
    return Array.from(groups.values());
  }, [filteredMedicalEvents]);

  const loadRecords = useCallback(
    async (providedToken?: string) => {
      setIsRecordsLoading(true);
      setRecordsError(null);

      try {
        const accessToken =
          providedToken ??
          (await SecureStore.getItemAsync("access_token"));
        if (!accessToken) {
          router.replace("/login");
          setRecordsError("Your session has expired. Please sign in again.");
          return;
        }

        const response = await fetch(`${API_BASE_URL}/api/records`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        let responseData: unknown = null;
        try {
          responseData = await response.json();
        } catch {
          responseData = null;
        }

        if (response.status === 401) {
          router.replace("/login");
          setRecordsError("Your session has expired. Please sign in again.");
          return;
        }

        if (!response.ok) {
          const detail = getBackendDetail(responseData);
          throw new Error(
            detail ?? `Could not load records (HTTP ${response.status}).`,
          );
        }

        if (!Array.isArray(responseData) || !responseData.every(isMedicalRecord)) {
          throw new Error("The server returned an invalid records response.");
        }

        setRecords(responseData);
        setHasLoadedRecords(true);
      } catch (error: unknown) {
        setRecordsError(
          error instanceof Error
            ? error.message
            : "Unable to load your medical records. Please try again.",
        );
      } finally {
        setIsRecordsLoading(false);
      }
    },
    [router],
  );

  const loadEvents = useCallback(
    async (providedToken?: string) => {
      setIsEventsLoading(true);
      setEventsError(null);

      try {
        const accessToken =
          providedToken ??
          (await SecureStore.getItemAsync("access_token"));
        if (!accessToken) {
          router.replace("/login");
          setEventsError("Your session has expired. Please sign in again.");
          return;
        }

        const response = await fetch(`${API_BASE_URL}/api/events?limit=200`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        let responseData: unknown = null;
        try {
          responseData = await response.json();
        } catch {
          responseData = null;
        }

        if (response.status === 401) {
          router.replace("/login");
          setEventsError("Your session has expired. Please sign in again.");
          return;
        }

        if (!response.ok) {
          const detail = getBackendDetail(responseData);
          throw new Error(
            detail ?? `Could not load medical events (HTTP ${response.status}).`,
          );
        }

        if (!isMedicalEventPage(responseData)) {
          throw new Error("The server returned an invalid events response.");
        }

        setMedicalEvents(responseData.items);
        setHasLoadedEvents(true);
      } catch (error: unknown) {
        setEventsError(
          error instanceof Error
            ? error.message
            : "Unable to load medical events. Please try again.",
        );
      } finally {
        setIsEventsLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    let isActive = true;

    async function loadSession() {
      try {
        const [accessToken, storedUser] = await Promise.all([
          SecureStore.getItemAsync("access_token"),
          SecureStore.getItemAsync("user"),
        ]);

        if (!isActive) {
          return;
        }

        if (!accessToken || !storedUser) {
          router.replace("/login");
          return;
        }

        const parsedUser = parseStoredUser(storedUser);
        if (!parsedUser) {
          Alert.alert(
            "Session Error",
            "Your saved account information could not be read. Please sign in again.",
          );
          await Promise.all([
            SecureStore.deleteItemAsync("access_token"),
            SecureStore.deleteItemAsync("user"),
          ]);
          router.replace("/login");
          return;
        }

        setUser(parsedUser);
        await Promise.all([loadRecords(accessToken), loadEvents(accessToken)]);
      } catch {
        if (isActive) {
          Alert.alert(
            "Session Error",
            "Unable to read your saved session. Please sign in again.",
          );
          router.replace("/login");
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadSession();

    return () => {
      isActive = false;
    };
  }, [loadEvents, loadRecords, router]);

  function openFilterSheet() {
    setDraftFromDate(fromDate);
    setDraftToDate(toDate);
    setDraftSortOrder(sortOrder);
    setFilterValidationError(null);
    setIsFilterSheetVisible(true);
  }

  function applyTimelineFilters() {
    const nextFromDate = draftFromDate.trim();
    const nextToDate = draftToDate.trim();
    if (
      (nextFromDate && !isValidISODate(nextFromDate)) ||
      (nextToDate && !isValidISODate(nextToDate))
    ) {
      setFilterValidationError("Enter dates in YYYY-MM-DD format.");
      return;
    }
    if (nextFromDate && nextToDate && nextFromDate > nextToDate) {
      setFilterValidationError("The start date must be before the end date.");
      return;
    }

    setFromDate(nextFromDate);
    setToDate(nextToDate);
    setSortOrder(draftSortOrder);
    setFilterValidationError(null);
    setIsFilterSheetVisible(false);
  }

  function clearTimelineFilters() {
    setFromDate("");
    setToDate("");
    setSortOrder("oldest");
    setDraftFromDate("");
    setDraftToDate("");
    setDraftSortOrder("oldest");
    setFilterValidationError(null);
    setIsFilterSheetVisible(false);
  }

  async function handleLogout() {
    setIsLoggingOut(true);

    try {
      await Promise.all([
        SecureStore.deleteItemAsync("access_token"),
        SecureStore.deleteItemAsync("user"),
      ]);
      router.replace("/login");
    } catch {
      Alert.alert(
        "Log Out Failed",
        "Your saved session could not be cleared. Please try again.",
      );
    } finally {
      setIsLoggingOut(false);
    }
  }

  async function chooseDocument() {
    try {
      const result = await File.pickFileAsync({
        multipleFiles: false,
        mimeTypes: [
          "application/pdf",
          "image/jpeg",
          "image/png",
        ],
      });

      if (result.canceled) {
        return;
      }

      const file = result.result;

      const fileType = getDocumentType(file);
      if (!fileType) {
        Alert.alert(
          "Unsupported file",
          "Please select a PDF, JPG, or PNG medical document.",
        );
        return;
      }

      setSelectedDocument(file);
      setSelectedDocumentType(fileType);
    } catch {
      Alert.alert(
        "Document Picker Error",
        "Unable to open the file picker. Please try again.",
      );
    }
  }

  async function handleUpload() {
    if (!selectedDocument || isUploadInProgress.current) {
      return;
    }

    isUploadInProgress.current = true;
    setIsUploading(true);

    try {
      if (
        !selectedDocument.uri ||
        !selectedDocument.name
      ) {
        Alert.alert(
          "Invalid document",
          "The selected file is missing its URI or name. Please choose it again.",
        );
        return;
      }

      const accessToken = await SecureStore.getItemAsync("access_token");
      if (!accessToken) {
        Alert.alert(
          "Session expired",
          "Your session has expired. Please sign in again.",
        );
        router.replace("/login");
        return;
      }

      const formData = new FormData();
      formData.append("files", selectedDocument);

      const uploadUrl = `${API_BASE_URL}/api/records/upload`;

      let response: Response;
      try {
        response = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          body: formData,
        });
      } catch (error: unknown) {
        const errorName =
          isRecord(error) && typeof error.name === "string"
            ? error.name
            : "Error";
        const errorMessage =
          error instanceof Error
            ? error.message
            : isRecord(error) && typeof error.message === "string"
              ? error.message
              : String(error);

        Alert.alert(
          "Connection Error",
          `Cannot connect to the backend. Make sure your phone and laptop are connected to the same Wi-Fi network.\n\n${errorName}: ${errorMessage}`,
        );
        return;
      }

      let responseData: unknown = null;
      try {
        responseData = await response.json();
      } catch {
        responseData = null;
      }

      if (response.status === 401) {
        Alert.alert(
          "Session expired",
          "Your session has expired. Please sign in again.",
        );
        router.replace("/login");
        return;
      }

      if (!response.ok) {
        const detail = getBackendDetail(responseData);
        if (response.status === 403) {
          Alert.alert(
            "Upload not permitted",
            detail ?? "You do not have permission to upload this document.",
          );
        } else if (response.status === 413) {
          Alert.alert("Upload failed", "File is too large.");
        } else if (response.status === 422) {
          Alert.alert(
            "Invalid document",
            detail ?? "The backend could not validate this upload.",
          );
        } else {
          Alert.alert(
            "Upload failed",
            detail
              ? `Request failed with HTTP ${response.status}. ${detail}`
              : `Request failed with HTTP ${response.status}.`,
          );
        }
        return;
      }

      if (response.status === 202) {
        await Promise.all([loadRecords(accessToken), loadEvents(accessToken)]);
        const recordDetails = getUploadedRecordDetails(responseData);
        Alert.alert(
          "Upload accepted",
          recordDetails
            ? `Medical record uploaded successfully.\n${recordDetails}`
            : "Medical record uploaded successfully.",
        );
        setSelectedDocument(null);
        setSelectedDocumentType(null);
      } else {
        Alert.alert(
          "Upload response",
          `The backend returned HTTP ${response.status}.`,
        );
      }
    } catch {
      Alert.alert(
        "Upload failed",
        "Unable to prepare the document upload. Please try again.",
      );
    } finally {
      isUploadInProgress.current = false;
      setIsUploading(false);
    }
  }

  if (isLoading || !user) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator color="#0F766E" size="large" />
        <Text style={styles.loadingText}>Loading your medical timeline...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.brand}>
            <View style={styles.logo}>
              <Text style={styles.logoText} accessibilityElementsHidden>+</Text>
            </View>
            <Text style={styles.appName}>Medical Timeline</Text>
          </View>
          <Pressable
            style={styles.settingsButton}
            onPress={() => Alert.alert("Settings", "Account settings are coming soon.")}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <Text style={styles.settingsIcon} accessibilityElementsHidden>⚙</Text>
          </Pressable>
        </View>

        <View style={styles.greetingSection}>
          <Text style={styles.greeting}>
            {user.full_name && user.full_name.trim()
              ? "Hello, " + user.full_name.trim() + " 👋"
              : "Hello 👋"}
          </Text>
          <Text style={styles.welcomeText}>
            Your health information, organized in one place.
          </Text>
        </View>

        <View style={mobileStyles.summaryCard}>
          <View style={mobileStyles.summaryHeader}>
            <View>
              <Text style={mobileStyles.eyebrow}>YOUR HEALTH HISTORY</Text>
              <Text style={mobileStyles.summaryTitle}>Summary of records</Text>
            </View>
            {hasLoadedEvents && !eventsError && !isEventsLoading ? (
              <Text style={mobileStyles.summaryCount}>
                {medicalEvents.length} {medicalEvents.length === 1 ? "event" : "events"}
              </Text>
            ) : null}
          </View>
          {hasLoadedEvents && !eventsError ? (
            <View style={mobileStyles.summaryStats}>
              <View style={mobileStyles.summaryStat}>
                <Text style={mobileStyles.summaryValue}>{eventTypeCounts.tests}</Text>
                <Text style={mobileStyles.summaryLabel}>Tests</Text>
              </View>
              <View style={mobileStyles.statDivider} />
              <View style={mobileStyles.summaryStat}>
                <Text style={mobileStyles.summaryValue}>{eventTypeCounts.visits}</Text>
                <Text style={mobileStyles.summaryLabel}>Visits</Text>
              </View>
              <Text style={mobileStyles.summaryNote}>Based on extracted events</Text>
            </View>
          ) : eventsError ? (
            <Text style={mobileStyles.summaryMessage}>
              Timeline summary is temporarily unavailable.
            </Text>
          ) : (
            <View style={mobileStyles.inlineLoading}>
              <ActivityIndicator color="#0F766E" size="small" />
              <Text style={mobileStyles.summaryMessage}>
                Loading your medical timeline...
              </Text>
            </View>
          )}
        </View>

        <View style={mobileStyles.uploadCard}>
          {selectedDocument && selectedDocumentType ? (
            <>
              <Text style={mobileStyles.uploadTitle}>Selected medical record</Text>
              <View style={mobileStyles.selectedDocument}>
                <View style={mobileStyles.documentIcon}>
                  <Text style={mobileStyles.documentIconText} accessibilityElementsHidden>↥</Text>
                </View>
                <View style={mobileStyles.documentInfo}>
                  <Text style={mobileStyles.documentName} numberOfLines={2}>
                    {selectedDocument.name}
                  </Text>
                  <Text style={mobileStyles.documentMeta}>
                    {selectedDocumentType}
                    {typeof selectedDocument.size === "number"
                      ? " · " + formatFileSize(selectedDocument.size)
                      : ""}
                  </Text>
                </View>
              </View>
              <View style={mobileStyles.uploadActions}>
                <Pressable
                  style={mobileStyles.secondaryButton}
                  onPress={chooseDocument}
                  accessibilityRole="button"
                >
                  <Text style={mobileStyles.secondaryButtonText}>Choose another</Text>
                </Pressable>
                <Pressable
                  style={mobileStyles.primaryButton}
                  onPress={handleUpload}
                  disabled={isUploading}
                  accessibilityRole="button"
                >
                  <Text style={mobileStyles.primaryButtonText}>
                    {isUploading ? "Uploading..." : "Continue"}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <View style={mobileStyles.uploadCopy}>
                <Text style={mobileStyles.uploadTitle}>Keep your records together</Text>
                <Text style={mobileStyles.uploadDescription}>
                  Add a PDF or image from your phone.
                </Text>
              </View>
              <Pressable
                style={mobileStyles.primaryButton}
                onPress={chooseDocument}
                accessibilityRole="button"
              >
                <Text style={mobileStyles.primaryButtonText}>Upload Medical Record</Text>
              </Pressable>
            </>
          )}
        </View>

        <View style={mobileStyles.timelineSection}>
          <View style={mobileStyles.sectionHeading}>
            <View>
              <Text style={mobileStyles.eyebrow}>YOUR CHRONOLOGICAL HISTORY</Text>
              <Text style={mobileStyles.sectionTitle}>Medical Events</Text>
            </View>
            <View style={mobileStyles.headingActions}>
              {isEventsLoading ? (
                <ActivityIndicator color="#0F766E" size="small" />
              ) : hasLoadedEvents && !eventsError ? (
                <Text style={mobileStyles.mutedCount}>
                  {medicalEvents.length} {medicalEvents.length === 1 ? "event" : "events"}
                </Text>
              ) : null}
              <Pressable
                style={mobileStyles.refreshButton}
                onPress={() => void loadEvents()}
                disabled={isEventsLoading}
                accessibilityRole="button"
                accessibilityLabel="Refresh medical events"
              >
                <Text style={mobileStyles.refreshText}>
                  {isEventsLoading ? "Updating" : "Refresh"}
                </Text>
              </Pressable>
            </View>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={mobileStyles.categoryScroll}
            contentContainerStyle={mobileStyles.categoryList}
          >
            {EVENT_CATEGORIES.map((category) => (
              <Pressable
                key={category}
                style={[
                  mobileStyles.categoryChip,
                  selectedCategory === category && mobileStyles.categoryChipSelected,
                ]}
                onPress={() => setSelectedCategory(category)}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedCategory === category }}
              >
                <Text
                  style={[
                    mobileStyles.categoryText,
                    selectedCategory === category && mobileStyles.categoryTextSelected,
                  ]}
                >
                  {category}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={mobileStyles.searchControls}>
            <View style={mobileStyles.searchBox}>
              <Text style={mobileStyles.searchGlyph} accessibilityElementsHidden>⌕</Text>
              <TextInput
                style={mobileStyles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search events..."
                placeholderTextColor="#94A3B8"
                returnKeyType="search"
                accessibilityLabel="Search medical events"
              />
              {searchQuery.length > 0 ? (
                <Pressable
                  onPress={() => setSearchQuery("")}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  hitSlop={8}
                >
                  <Text style={mobileStyles.clearSearch}>×</Text>
                </Pressable>
              ) : null}
            </View>
            <Pressable
              style={[
                mobileStyles.filterButton,
                (fromDate || toDate || sortOrder === "newest") &&
                  mobileStyles.filterButtonActive,
              ]}
              onPress={openFilterSheet}
              accessibilityRole="button"
            >
              <Text style={mobileStyles.filterButtonText}>Filters</Text>
              {(fromDate || toDate || sortOrder === "newest") ? (
                <View style={mobileStyles.activeFilterDot} />
              ) : null}
            </Pressable>
          </View>

          {eventsError ? (
            <View style={mobileStyles.errorCard}>
              <Text style={mobileStyles.errorText}>
                Unable to load your medical timeline.
              </Text>
              <Pressable
                style={mobileStyles.retryButton}
                onPress={() => void loadEvents()}
                disabled={isEventsLoading}
                accessibilityRole="button"
              >
                <Text style={mobileStyles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}

          {(isEventsLoading || (!hasLoadedEvents && !eventsError)) &&
          medicalEvents.length === 0 ? (
            <View style={mobileStyles.loadingCard}>
              <ActivityIndicator color="#0F766E" />
              <Text style={mobileStyles.loadingMessage}>
                Loading your medical timeline...
              </Text>
            </View>
          ) : null}

          {hasLoadedEvents &&
          !isEventsLoading &&
          !eventsError &&
          medicalEvents.length === 0 ? (
            <View style={mobileStyles.emptyCard}>
              <View style={mobileStyles.emptyIcon}>
                <Text style={mobileStyles.emptyIconText} accessibilityElementsHidden>+</Text>
              </View>
              <Text style={mobileStyles.emptyTitle}>No medical events yet</Text>
              <Text style={mobileStyles.emptyDescription}>
                Upload a medical document to start building your timeline.
              </Text>
            </View>
          ) : null}

          {hasLoadedEvents &&
          !eventsError &&
          medicalEvents.length > 0 &&
          filteredMedicalEvents.length === 0 ? (
            <View style={mobileStyles.noMatchesCard}>
              <Text style={mobileStyles.noMatchesTitle}>No matching events</Text>
              <Text style={mobileStyles.noMatchesDescription}>
                Try a different search or filter.
              </Text>
              <Pressable
                onPress={() => {
                  setSearchQuery("");
                  setSelectedCategory("All");
                  clearTimelineFilters();
                }}
                accessibilityRole="button"
              >
                <Text style={mobileStyles.clearFiltersText}>Clear search and filters</Text>
              </Pressable>
            </View>
          ) : null}

          {timelineGroups.map((group) => (
            <View key={group.key} style={mobileStyles.timelineGroup}>
              <View style={mobileStyles.monthHeading}>
                <Text style={mobileStyles.monthHeadingText}>{group.label}</Text>
                <View style={mobileStyles.monthRule} />
              </View>
              {group.events.map((event, index) => (
                <View key={event.id} style={mobileStyles.eventTimelineRow}>
                  <View style={mobileStyles.markerColumn}>
                    {index < group.events.length - 1 ? (
                      <View style={mobileStyles.timelineLine} />
                    ) : null}
                    <View style={mobileStyles.timelineDot} />
                  </View>
                  <View style={mobileStyles.eventCard}>
                    <View style={mobileStyles.eventHeader}>
                      <Text style={mobileStyles.eventDate}>
                        {formatEventDate(event.event_date)}
                      </Text>
                      <View
                        style={[
                          mobileStyles.eventTypeBadge,
                          getEventCategoryStyle(event.event_type),
                        ]}
                      >
                        <Text style={mobileStyles.eventTypeText}>
                          {formatEventType(event.event_type).toUpperCase() || "EVENT"}
                        </Text>
                      </View>
                    </View>
                    <Text style={mobileStyles.eventTitle}>
                      {typeof event.title === "string" && event.title.trim()
                        ? event.title.trim()
                        : formatEventType(event.event_type) || "Medical event"}
                    </Text>
                    {event.description.trim() ? (
                      <Text style={mobileStyles.eventDescription}>
                        {event.description.trim()}
                      </Text>
                    ) : null}
                    {typeof event.provider === "string" && event.provider.trim() ? (
                      <Text style={mobileStyles.eventMetadata}>
                        Provider: {event.provider.trim()}
                      </Text>
                    ) : null}
                    {typeof event.source_page === "number" &&
                    Number.isInteger(event.source_page) &&
                    event.source_page > 0 ? (
                      <Text style={mobileStyles.eventMetadata}>
                        Page {event.source_page} of source
                      </Text>
                    ) : null}
                    {typeof event.confidence === "number" &&
                    Number.isFinite(event.confidence) &&
                    event.confidence >= 0 &&
                    event.confidence <= 1 ? (
                      <Text style={mobileStyles.eventMetadata}>
                        Confidence: {Math.round(event.confidence * 100)}%
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          ))}
        </View>

        <View style={mobileStyles.recordsSection}>
          <View style={mobileStyles.sectionHeading}>
            <View>
              <Text style={mobileStyles.eyebrow}>UPLOADED DOCUMENTS</Text>
              <Text style={mobileStyles.sectionTitle}>Medical Records</Text>
            </View>
            {isRecordsLoading ? (
              <ActivityIndicator color="#0F766E" size="small" />
            ) : hasLoadedRecords && !recordsError ? (
              <Text style={mobileStyles.mutedCount}>
                {records.length} {records.length === 1 ? "record" : "records"}
              </Text>
            ) : null}
          </View>

          {recordsError ? (
            <View style={mobileStyles.errorCard}>
              <Text style={mobileStyles.errorText}>
                Unable to load your medical records.
              </Text>
              <Pressable
                style={mobileStyles.retryButton}
                onPress={() => void loadRecords()}
                accessibilityRole="button"
              >
                <Text style={mobileStyles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}

          {(isRecordsLoading || (!hasLoadedRecords && !recordsError)) &&
          records.length === 0 ? (
            <View style={mobileStyles.loadingCard}>
              <ActivityIndicator color="#0F766E" />
              <Text style={mobileStyles.loadingMessage}>
                Loading your medical records...
              </Text>
            </View>
          ) : null}

          {hasLoadedRecords &&
          !isRecordsLoading &&
          !recordsError &&
          records.length === 0 ? (
            <View style={mobileStyles.recordsEmptyCard}>
              <Text style={mobileStyles.noMatchesTitle}>No medical records yet</Text>
              <Text style={mobileStyles.noMatchesDescription}>
                Uploaded documents will appear here.
              </Text>
            </View>
          ) : null}

          {records.map((record) => {
            const status = record.status.toLowerCase();
            const statusStyle =
              status === "completed"
                ? mobileStyles.statusCompleted
                : status === "failed"
                  ? mobileStyles.statusFailed
                  : mobileStyles.statusProcessing;
            const statusIcon =
              status === "completed" ? "✓" : status === "failed" ? "!" : "◷";

            return (
              <View key={record.id} style={mobileStyles.recordCard}>
                <Text style={mobileStyles.recordFilename}>
                  {record.original_filename.trim() || "Medical document"}
                </Text>
                <View style={[mobileStyles.recordStatus, statusStyle]}>
                  <Text style={[mobileStyles.recordStatusIcon, statusStyle]}>
                    {statusIcon}
                  </Text>
                  <Text style={[mobileStyles.recordStatusText, statusStyle]}>
                    {getRecordStatusLabel(record.status)}
                  </Text>
                </View>
                <Text style={mobileStyles.recordDate}>
                  Uploaded {formatRecordDate(record.uploaded_at)}
                </Text>
                {typeof record.processed_at === "string" &&
                record.processed_at.trim() ? (
                  <Text style={mobileStyles.recordDate}>
                    Processed {formatRecordDate(record.processed_at)}
                  </Text>
                ) : null}
                {status === "failed" &&
                typeof record.error_message === "string" &&
                record.error_message.trim() ? (
                  <Text style={mobileStyles.recordError}>
                    {record.error_message.trim()}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>

        <Pressable
          style={styles.logoutButton}
          onPress={handleLogout}
          disabled={isLoggingOut}
          accessibilityRole="button"
        >
          <Text style={styles.logoutButtonText}>
            {isLoggingOut ? "Logging out..." : "Log Out"}
          </Text>
        </Pressable>
      </ScrollView>

      <Modal
        visible={isFilterSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIsFilterSheetVisible(false)}
      >
        <View style={mobileStyles.filterBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setIsFilterSheetVisible(false)}
            accessibilityRole="button"
            accessibilityLabel="Close filters"
          />
          <View style={mobileStyles.filterSheet}>
            <View style={mobileStyles.sheetHandle} />
            <View style={mobileStyles.filterSheetHeader}>
              <Text style={mobileStyles.filterSheetTitle}>Filter medical events</Text>
              <Pressable
                onPress={() => setIsFilterSheetVisible(false)}
                accessibilityRole="button"
                hitSlop={8}
              >
                <Text style={mobileStyles.closeSheetText}>Close</Text>
              </Pressable>
            </View>

            <Text style={mobileStyles.filterLabel}>Date range</Text>
            <View style={mobileStyles.dateFields}>
              <View style={mobileStyles.dateField}>
                <Text style={mobileStyles.dateFieldLabel}>From date</Text>
                <TextInput
                  value={draftFromDate}
                  onChangeText={setDraftFromDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#94A3B8"
                  keyboardType="numbers-and-punctuation"
                  returnKeyType="done"
                  maxLength={10}
                  style={mobileStyles.dateInput}
                  accessibilityLabel="From date"
                />
              </View>
              <View style={mobileStyles.dateField}>
                <Text style={mobileStyles.dateFieldLabel}>To date</Text>
                <TextInput
                  value={draftToDate}
                  onChangeText={setDraftToDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#94A3B8"
                  keyboardType="numbers-and-punctuation"
                  returnKeyType="done"
                  maxLength={10}
                  style={mobileStyles.dateInput}
                  accessibilityLabel="To date"
                />
              </View>
            </View>

            <Text style={mobileStyles.filterLabel}>Sort</Text>
            <View style={mobileStyles.sortOptions}>
              <Pressable
                style={[
                  mobileStyles.sortOption,
                  draftSortOrder === "newest" && mobileStyles.sortOptionSelected,
                ]}
                onPress={() => setDraftSortOrder("newest")}
                accessibilityRole="button"
                accessibilityState={{ selected: draftSortOrder === "newest" }}
              >
                <Text
                  style={[
                    mobileStyles.sortOptionText,
                    draftSortOrder === "newest" &&
                      mobileStyles.sortOptionTextSelected,
                  ]}
                >
                  Newest first
                </Text>
              </Pressable>
              <Pressable
                style={[
                  mobileStyles.sortOption,
                  draftSortOrder === "oldest" && mobileStyles.sortOptionSelected,
                ]}
                onPress={() => setDraftSortOrder("oldest")}
                accessibilityRole="button"
                accessibilityState={{ selected: draftSortOrder === "oldest" }}
              >
                <Text
                  style={[
                    mobileStyles.sortOptionText,
                    draftSortOrder === "oldest" &&
                      mobileStyles.sortOptionTextSelected,
                  ]}
                >
                  Oldest first
                </Text>
              </Pressable>
            </View>

            {filterValidationError ? (
              <Text style={mobileStyles.filterError}>{filterValidationError}</Text>
            ) : null}

            <View style={mobileStyles.filterActions}>
              <Pressable
                style={mobileStyles.clearFilterButton}
                onPress={clearTimelineFilters}
                accessibilityRole="button"
              >
                <Text style={mobileStyles.clearFilterText}>Clear</Text>
              </Pressable>
              <Pressable
                style={mobileStyles.applyFilterButton}
                onPress={applyTimelineFilters}
                accessibilityRole="button"
              >
                <Text style={mobileStyles.applyFilterText}>Apply filters</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#F8FAFC",
  },
  loadingText: {
    color: "#64748B",
    fontSize: 14,
  },
  content: {
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 32,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  logo: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#0F766E",
    justifyContent: "center",
    alignItems: "center",
  },
  logoText: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "700",
  },
  appName: {
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "800",
  },
  settingsButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  settingsIcon: {
    color: "#475569",
    fontSize: 21,
  },
  greetingSection: {
    marginTop: 30,
    marginBottom: 22,
  },
  greeting: {
    color: "#0F172A",
    fontSize: 25,
    fontWeight: "800",
    lineHeight: 33,
  },
  email: {
    color: "#64748B",
    fontSize: 14,
    marginTop: 5,
  },
  welcomeText: {
    color: "#64748B",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 9,
  },
  uploadCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#DCEFEA",
    padding: 20,
    shadowColor: "#0F766E",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 2,
  },
  uploadIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#E6F4F1",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  uploadIcon: {
    color: "#0F766E",
    fontSize: 27,
    fontWeight: "700",
  },
  uploadTitle: {
    color: "#0F172A",
    fontSize: 18,
    lineHeight: 25,
    fontWeight: "800",
  },
  uploadDescription: {
    color: "#64748B",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  uploadButton: {
    minHeight: 52,
    marginTop: 18,
    paddingHorizontal: 16,
    borderRadius: 13,
    backgroundColor: "#0F766E",
    alignItems: "center",
    justifyContent: "center",
  },
  uploadButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  selectedDocumentCard: {
    marginTop: 18,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#DCEFEA",
    backgroundColor: "#F8FCFB",
  },
  selectedDocumentHeading: {
    color: "#334155",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 12,
  },
  selectedDocumentDetails: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  documentIcon: {
    fontSize: 28,
  },
  documentInfo: {
    flex: 1,
  },
  documentName: {
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "700",
  },
  documentMetadata: {
    color: "#64748B",
    fontSize: 12,
    marginTop: 4,
  },
  documentActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 15,
  },
  chooseAnotherButton: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#0F766E",
    alignItems: "center",
    justifyContent: "center",
  },
  chooseAnotherText: {
    color: "#0F766E",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  timelineSection: {
    marginTop: 30,
  },
  timelineHeading: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 10,
  },
  sectionEyebrow: {
    color: "#0F766E",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
    marginBottom: 5,
  },
  sectionTitle: {
    color: "#0F172A",
    fontSize: 22,
    fontWeight: "800",
  },
  recordsBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: "#E6F4F1",
  },
  recordsBadgeText: {
    color: "#0F766E",
    fontSize: 12,
    fontWeight: "700",
  },
  recordsLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 16,
    padding: 20,
  },
  recordsLoadingText: {
    color: "#64748B",
    fontSize: 14,
  },
  recordsError: {
    marginTop: 16,
    padding: 16,
    borderRadius: 14,
    backgroundColor: "#FEF2F2",
  },
  recordsErrorText: {
    color: "#991B1B",
    fontSize: 14,
  },
  recordsRetryText: {
    color: "#0F766E",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 10,
  },
  recordCard: {
    marginTop: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
  },
  recordFilename: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "700",
  },
  recordStatus: {
    alignSelf: "flex-start",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
  },
  recordStatusCompleted: {
    color: "#0F766E",
    backgroundColor: "#E6F4F1",
  },
  recordStatusProcessing: {
    color: "#92400E",
    backgroundColor: "#FEF3C7",
  },
  recordStatusFailed: {
    color: "#7F1D1D",
    backgroundColor: "#FEE2E2",
  },
  recordDate: {
    color: "#64748B",
    fontSize: 12,
    marginTop: 6,
  },
  recordError: {
    color: "#7F1D1D",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
    padding: 9,
    borderRadius: 9,
    backgroundColor: "#FFF7F7",
  },
  medicalEventsSection: {
    marginTop: 26,
  },
  eventsHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  eventsTitle: {
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "800",
  },
  eventsRefreshText: {
    color: "#0F766E",
    fontSize: 13,
    fontWeight: "700",
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  eventsEmptyState: {
    marginTop: 8,
    padding: 22,
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
  },
  eventTimelineRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
    paddingBottom: 12,
  },
  eventMarkerColumn: {
    width: 14,
    position: "relative",
    alignItems: "center",
  },
  eventTimelineLine: {
    position: "absolute",
    top: 0,
    bottom: -12,
    width: 2,
    backgroundColor: "#B7DED5",
  },
  eventTimelineDot: {
    width: 11,
    height: 11,
    marginTop: 18,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#0F766E",
    backgroundColor: "#FFFFFF",
  },
  eventCard: {
    flex: 1,
    padding: 15,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#DCEFEA",
    backgroundColor: "#FFFFFF",
  },
  eventDate: {
    color: "#0F766E",
    fontSize: 12,
    fontWeight: "700",
  },
  eventType: {
    alignSelf: "flex-start",
    marginTop: 7,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    color: "#475569",
    backgroundColor: "#F1F5F9",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  eventTitle: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 8,
  },
  eventDescription: {
    color: "#475569",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  eventMetadata: {
    color: "#64748B",
    fontSize: 12,
    marginTop: 7,
  },
  emptyState: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 30,
    alignItems: "center",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
  },
  emptyIconContainer: {
    width: 62,
    height: 62,
    borderRadius: 21,
    backgroundColor: "#F0FDFA",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 15,
  },
  emptyIcon: {
    color: "#0F766E",
    fontSize: 34,
    fontWeight: "700",
  },
  emptyTitle: {
    color: "#0F172A",
    fontSize: 17,
    fontWeight: "800",
    textAlign: "center",
  },
  emptyDescription: {
    maxWidth: 300,
    color: "#64748B",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginTop: 8,
  },
  logoutButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 22,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
  },
  logoutButtonText: {
    color: "#475569",
    fontSize: 15,
    fontWeight: "700",
  },
});

const mobileStyles = StyleSheet.create({
  summaryCard: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E0EBE7",
    backgroundColor: "#FFFFFF",
    shadowColor: "#173B35",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 9,
    elevation: 1,
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  eyebrow: {
    color: "#0F766E",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 4,
  },
  summaryTitle: {
    color: "#102A2A",
    fontSize: 17,
    fontWeight: "800",
  },
  summaryCount: {
    color: "#647875",
    fontSize: 11,
    fontWeight: "700",
  },
  summaryStats: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 13,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: "#EFF3F1",
  },
  summaryStat: {
    minWidth: 63,
  },
  summaryValue: {
    color: "#0F766E",
    fontSize: 22,
    fontWeight: "800",
  },
  summaryLabel: {
    color: "#647875",
    fontSize: 12,
    fontWeight: "600",
  },
  statDivider: {
    width: 1,
    height: 32,
    marginHorizontal: 13,
    backgroundColor: "#E6EEEB",
  },
  summaryNote: {
    flex: 1,
    color: "#83938F",
    fontSize: 10,
    lineHeight: 14,
    textAlign: "right",
  },
  summaryMessage: {
    color: "#748580",
    fontSize: 12,
    lineHeight: 17,
  },
  inlineLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginTop: 12,
  },
  uploadCard: {
    marginTop: 13,
    padding: 15,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#DCEBE6",
    backgroundColor: "#FFFFFF",
  },
  uploadCopy: {
    marginBottom: 11,
  },
  uploadTitle: {
    color: "#102A2A",
    fontSize: 14,
    fontWeight: "800",
  },
  uploadDescription: {
    color: "#748580",
    fontSize: 12,
    marginTop: 3,
  },
  primaryButton: {
    flex: 1,
    minHeight: 45,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#0F766E",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },
  selectedDocument: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 11,
  },
  documentIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "#E8F4F1",
  },
  documentIconText: {
    color: "#0F766E",
    fontSize: 21,
    fontWeight: "700",
  },
  documentInfo: {
    flex: 1,
  },
  documentName: {
    color: "#173B35",
    fontSize: 13,
    fontWeight: "700",
  },
  documentMeta: {
    color: "#7A8A86",
    fontSize: 11,
    marginTop: 3,
  },
  uploadActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 13,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 45,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#B8D5CD",
  },
  secondaryButtonText: {
    color: "#0F766E",
    fontSize: 12,
    fontWeight: "700",
  },
  timelineSection: {
    marginTop: 26,
  },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 8,
  },
  sectionTitle: {
    color: "#102A2A",
    fontSize: 21,
    lineHeight: 26,
    fontWeight: "800",
  },
  headingActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  mutedCount: {
    color: "#71827D",
    fontSize: 10,
    fontWeight: "600",
  },
  refreshButton: {
    minHeight: 39,
    justifyContent: "center",
    paddingHorizontal: 9,
    borderRadius: 11,
    backgroundColor: "#EAF4F1",
  },
  refreshText: {
    color: "#0F766E",
    fontSize: 11,
    fontWeight: "700",
  },
  categoryScroll: {
    marginTop: 12,
    marginHorizontal: -18,
  },
  categoryList: {
    paddingHorizontal: 18,
    paddingBottom: 3,
    gap: 8,
  },
  categoryChip: {
    minHeight: 39,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#DDE7E3",
    backgroundColor: "#FFFFFF",
  },
  categoryChipSelected: {
    borderColor: "#0F766E",
    backgroundColor: "#0F766E",
  },
  categoryText: {
    color: "#52645F",
    fontSize: 11,
    fontWeight: "700",
  },
  categoryTextSelected: {
    color: "#FFFFFF",
  },
  searchControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 11,
    marginBottom: 12,
  },
  searchBox: {
    flex: 1,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E0E9E5",
    backgroundColor: "#FFFFFF",
  },
  searchGlyph: {
    color: "#7A8A86",
    fontSize: 22,
    marginRight: 7,
  },
  searchInput: {
    flex: 1,
    minHeight: 42,
    paddingVertical: 0,
    color: "#173B35",
    fontSize: 12,
  },
  clearSearch: {
    color: "#7A8A86",
    fontSize: 20,
    paddingHorizontal: 4,
  },
  filterButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#DDE7E3",
    backgroundColor: "#FFFFFF",
  },
  filterButtonActive: {
    borderColor: "#0F766E",
    backgroundColor: "#EAF4F1",
  },
  filterButtonText: {
    color: "#31534C",
    fontSize: 11,
    fontWeight: "700",
  },
  activeFilterDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#0F766E",
  },
  errorCard: {
    marginBottom: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#F0D8D5",
    backgroundColor: "#FFF9F8",
  },
  errorText: {
    color: "#81443D",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },
  retryButton: {
    alignSelf: "flex-start",
    minHeight: 38,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  retryText: {
    color: "#0F766E",
    fontSize: 12,
    fontWeight: "800",
  },
  loadingCard: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 15,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
  },
  loadingMessage: {
    color: "#62746F",
    fontSize: 12,
  },
  emptyCard: {
    alignItems: "center",
    padding: 22,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E0E9E5",
    backgroundColor: "#FFFFFF",
  },
  emptyIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: "#E8F4F1",
    marginBottom: 10,
  },
  emptyIconText: {
    color: "#0F766E",
    fontSize: 24,
    fontWeight: "700",
  },
  emptyTitle: {
    color: "#173B35",
    fontSize: 15,
    fontWeight: "800",
    textAlign: "center",
  },
  emptyDescription: {
    maxWidth: 280,
    color: "#758681",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 6,
  },
  noMatchesCard: {
    alignItems: "center",
    padding: 19,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#E2EAE7",
    backgroundColor: "#FFFFFF",
  },
  noMatchesTitle: {
    color: "#173B35",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },
  noMatchesDescription: {
    color: "#758681",
    fontSize: 11,
    textAlign: "center",
    marginTop: 5,
  },
  clearFiltersText: {
    color: "#0F766E",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 10,
    paddingVertical: 5,
  },
  timelineGroup: {
    marginTop: 12,
  },
  monthHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  monthHeadingText: {
    color: "#3C6259",
    fontSize: 12,
    fontWeight: "800",
  },
  monthRule: {
    flex: 1,
    height: 1,
    backgroundColor: "#DCE7E3",
  },
  eventTimelineRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 9,
    paddingBottom: 11,
  },
  markerColumn: {
    width: 14,
    position: "relative",
    alignItems: "center",
  },
  timelineLine: {
    position: "absolute",
    top: 0,
    bottom: -11,
    width: 2,
    backgroundColor: "#C7DDD6",
  },
  timelineDot: {
    width: 11,
    height: 11,
    marginTop: 17,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#0F766E",
    backgroundColor: "#F6F8F7",
    zIndex: 1,
  },
  eventCard: {
    flex: 1,
    padding: 13,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#E0E9E5",
    backgroundColor: "#FFFFFF",
    shadowColor: "#173B35",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.035,
    shadowRadius: 5,
    elevation: 1,
  },
  eventHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  eventDate: {
    flexShrink: 1,
    color: "#0F766E",
    fontSize: 11,
    fontWeight: "700",
  },
  eventTypeBadge: {
    flexShrink: 0,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 9,
  },
  eventTypeText: {
    color: "#435650",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  eventTypeVisit: {
    backgroundColor: "#E5F3EF",
  },
  eventTypeTest: {
    backgroundColor: "#EAF0F8",
  },
  eventTypeDiagnosis: {
    backgroundColor: "#F0ECF8",
  },
  eventTypeTreatment: {
    backgroundColor: "#F8F0E4",
  },
  eventTypeMedication: {
    backgroundColor: "#EEF3E7",
  },
  eventTypeOther: {
    backgroundColor: "#EFF3F1",
  },
  eventTitle: {
    color: "#173B35",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
    marginTop: 7,
  },
  eventDescription: {
    color: "#52645F",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
  },
  eventMetadata: {
    color: "#7A8985",
    fontSize: 10,
    lineHeight: 15,
    marginTop: 6,
  },
  recordsSection: {
    marginTop: 24,
  },
  recordsEmptyCard: {
    marginTop: 11,
    padding: 17,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E0E9E5",
    backgroundColor: "#FFFFFF",
  },
  recordCard: {
    marginTop: 10,
    padding: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E0E9E5",
    backgroundColor: "#FFFFFF",
  },
  recordFilename: {
    color: "#173B35",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  recordStatus: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 7,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 9,
  },
  statusCompleted: {
    color: "#0F766E",
    backgroundColor: "#E6F4F1",
  },
  statusProcessing: {
    color: "#8A620E",
    backgroundColor: "#FBF2D9",
  },
  statusFailed: {
    color: "#8A4B45",
    backgroundColor: "#F8EAE8",
  },
  recordStatusIcon: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "800",
  },
  recordStatusText: {
    fontSize: 10,
    fontWeight: "800",
  },
  recordDate: {
    color: "#74847F",
    fontSize: 10,
    marginTop: 5,
  },
  recordError: {
    color: "#855751",
    fontSize: 10,
    lineHeight: 15,
    marginTop: 7,
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#FCF5F4",
  },
  filterBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(15, 23, 42, 0.36)",
  },
  filterSheet: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: "#FFFFFF",
  },
  sheetHandle: {
    width: 38,
    height: 4,
    alignSelf: "center",
    borderRadius: 2,
    backgroundColor: "#D8E1DE",
    marginBottom: 14,
  },
  filterSheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 17,
  },
  filterSheetTitle: {
    color: "#173B35",
    fontSize: 17,
    fontWeight: "800",
  },
  closeSheetText: {
    color: "#0F766E",
    fontSize: 12,
    fontWeight: "700",
    paddingVertical: 8,
    paddingHorizontal: 5,
  },
  filterLabel: {
    color: "#394D48",
    fontSize: 11,
    fontWeight: "800",
    marginBottom: 7,
  },
  dateFields: {
    flexDirection: "row",
    gap: 9,
    marginBottom: 16,
  },
  dateField: {
    flex: 1,
  },
  dateFieldLabel: {
    color: "#7A8985",
    fontSize: 10,
    marginBottom: 5,
  },
  dateInput: {
    minHeight: 43,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DDE7E3",
    color: "#173B35",
    fontSize: 12,
  },
  sortOptions: {
    flexDirection: "row",
    gap: 8,
  },
  sortOption: {
    flex: 1,
    minHeight: 43,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DDE7E3",
    backgroundColor: "#FFFFFF",
  },
  sortOptionSelected: {
    borderColor: "#0F766E",
    backgroundColor: "#EAF4F1",
  },
  sortOptionText: {
    color: "#52645F",
    fontSize: 11,
    fontWeight: "700",
  },
  sortOptionTextSelected: {
    color: "#0F766E",
  },
  filterError: {
    color: "#9B3830",
    fontSize: 11,
    marginTop: 9,
  },
  filterActions: {
    flexDirection: "row",
    gap: 9,
    marginTop: 18,
  },
  clearFilterButton: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 17,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#DDE7E3",
  },
  clearFilterText: {
    color: "#52645F",
    fontSize: 12,
    fontWeight: "700",
  },
  applyFilterButton: {
    flex: 1,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 17,
    borderRadius: 11,
    backgroundColor: "#0F766E",
  },
  applyFilterText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
});
