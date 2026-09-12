import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { Task } from '@/contexts/tasks-context';
import { AIAction, ParseIntentResult } from './ai-types';
import { parseIntent as mockParseIntent } from './mock-intent-parser';
import { getTodayString, getCurrentTimeStringIST } from '@/lib/date-time';

export type AIParseContext = {
  tasks: Task[];
  currentDate?: string;
  currentTime?: string;
  timezone?: string;
};

/**
 * Dynamically resolves the development server base URL:
 * 1. process.env.EXPO_PUBLIC_AI_SERVER_URL (explicit complete URL, e.g., "http://192.168.1.10:3001")
 * 2. process.env.EXPO_PUBLIC_DEV_SERVER_IP (explicit IP, e.g., "192.168.1.10")
 * 3. Constants.expoConfig?.hostUri (automatically extracts PC LAN IP when testing on physical phone via Expo Go)
 * 4. 10.0.2.2:3001 for Android Emulator / localhost:3001 for Web/iOS Simulator.
 */
export function getDevServerBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_AI_SERVER_URL) {
    return process.env.EXPO_PUBLIC_AI_SERVER_URL.replace(/\/$/, '');
  }

  const explicitIp = process.env.EXPO_PUBLIC_DEV_SERVER_IP;
  if (explicitIp) {
    return `http://${explicitIp.trim()}:3001`;
  }

  // Extract developer PC IP from Expo Metro bundler hostUri (e.g. "192.168.1.50:8081" -> "192.168.1.50")
  const hostUri = Constants.expoConfig?.hostUri || (Constants as any).manifest?.debuggerHost || (Constants as any).experienceUrl;
  if (hostUri && typeof hostUri === 'string' && hostUri.includes(':')) {
    const pcIp = hostUri.split(':')[0];
    if (pcIp && pcIp !== 'localhost' && pcIp !== '127.0.0.1') {
      return `http://${pcIp}:3001`;
    }
  }

  const defaultHost = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
  return `http://${defaultHost}:3001`;
}

export async function parseIntentWithAI(
  userMessage: string,
  context: AIParseContext
): Promise<ParseIntentResult> {
  const trimmed = userMessage.trim();
  if (!trimmed) {
    return { success: false, error: 'Please enter a message.' };
  }

  const currentDateStr = context.currentDate ?? getTodayString();
  const currentTimeStr = context.currentTime ?? getCurrentTimeStringIST();
  const timezone = context.timezone ?? 'Asia/Kolkata';
  const serverBaseUrl = getDevServerBaseUrl();
  const endpoint = `${serverBaseUrl}/api/parse-intent`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9000);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        userMessage: trimmed,
        context: {
          tasks: context.tasks,
          currentDate: currentDateStr,
          currentTime: currentTimeStr,
          timezone,
        },
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const isQuotaErr =
        response.status === 429 ||
        errorData.errorType === 'GEMINI_API_ERROR' ||
        (typeof errorData.error === 'string' &&
          (errorData.error.includes('429') ||
            errorData.error.includes('RESOURCE_EXHAUSTED') ||
            errorData.error.includes('quota')));
      const serverErr = errorData.error || `HTTP ${response.status}`;

      console.warn(`[AI_BACKEND_ERROR] Server status ${response.status}: ${serverErr}`);

      const mockResult = mockParseIntent(trimmed);
      const noticeReason = isQuotaErr
        ? '⚡ AI quota limit reached (HTTP 429) — using local command mode.'
        : `⚡ AI backend error (${serverErr}) — using local command mode.`;

      return {
        ...mockResult,
        mode: 'mock_fallback',
        notice: noticeReason,
      };
    }

    let data;
    try {
      data = await response.json();
    } catch (parseErr: any) {
      console.warn(`[MALFORMED_RESPONSE] Could not parse JSON from ${endpoint}: ${parseErr.message}`);
      const mockResult = mockParseIntent(trimmed);
      return {
        ...mockResult,
        mode: 'mock_fallback',
        notice: `⚡ AI backend returned malformed response — using basic command mode.`,
      };
    }

    if (data && data.success && Array.isArray(data.actions)) {
      return {
        success: true,
        actions: data.actions as AIAction[],
        mode: 'real_ai',
      };
    }

    console.warn(`[MALFORMED_RESPONSE] Server returned missing/invalid "actions" array:`, data);
    const mockResult = mockParseIntent(trimmed);
    return {
      ...mockResult,
      mode: 'mock_fallback',
      notice: `⚡ AI response schema mismatch — using basic command mode.`,
    };
  } catch (error: any) {
    const isTimeout = error.name === 'AbortError';
    const reason = isTimeout ? 'Request timed out' : 'Server unreachable / network offline';

    console.warn(`[SERVER_UNREACHABLE] Could not connect to AI backend at ${endpoint}: ${reason}`);

    const mockResult = mockParseIntent(trimmed);
    return {
      ...mockResult,
      mode: 'mock_fallback',
      notice: `⚡ AI server offline at ${serverBaseUrl} — using basic command mode.`,
    };
  }
}
