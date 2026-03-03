import axios from 'axios';
import { extractEnvVariable } from 'librechat-data-provider';
import type { TEndpoint } from 'librechat-data-provider';
import { logger } from '@librechat/data-schemas';

interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validates if an endpoint is accessible by sending a simple request
 * @param endpoint - The endpoint configuration to validate
 * @param timeout - Request timeout in milliseconds (default: 5000)
 * @returns Promise<ValidationResult>
 */
export async function validateEndpoint(
  endpoint: TEndpoint,
  timeout: number = 5000,
): Promise<ValidationResult> {
  const { name, baseURL, apiKey } = endpoint;

  if (!baseURL || !apiKey) {
    return {
      isValid: false,
      error: 'Missing baseURL or apiKey',
    };
  }

  const resolvedBaseURL = extractEnvVariable(baseURL);
  const resolvedApiKey = extractEnvVariable(apiKey);

  if (!resolvedBaseURL || !resolvedApiKey) {
    return {
      isValid: false,
      error: 'Failed to resolve environment variables',
    };
  }

  if (resolvedApiKey === 'user_provided') {
    logger.info(`[${name}] Skipping validation - user_provided key`);
    return { isValid: true };
  }

  try {
    const url = `${resolvedBaseURL.replace(/\/$/, '')}/models`;
    
    logger.info(`[${name}] Validating endpoint: ${url}`);

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${resolvedApiKey}`,
        'Content-Type': 'application/json',
      },
      timeout,
      validateStatus: (status) => status < 500,
    });

    if (response.status >= 200 && response.status < 300) {
      logger.info(`[${name}] Validation successful`);
      return { isValid: true };
    }

    if (response.status === 401 || response.status === 403) {
      logger.warn(`[${name}] Authentication failed (${response.status})`);
      return {
        isValid: false,
        error: `Authentication failed: ${response.status}`,
      };
    }

    logger.warn(`[${name}] Unexpected status: ${response.status}`);
    return {
      isValid: false,
      error: `HTTP ${response.status}`,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        logger.error(`[${name}] Connection failed: ${error.code}`);
        return {
          isValid: false,
          error: `Connection failed: ${error.code}`,
        };
      }

      if (error.response) {
        logger.error(`[${name}] Request failed: ${error.response.status}`);
        return {
          isValid: false,
          error: `HTTP ${error.response.status}`,
        };
      }
    }

    logger.error(`[${name}] Validation error:`, error);
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Validates multiple endpoints in parallel
 * @param endpoints - Array of endpoint configurations
 * @param timeout - Request timeout in milliseconds
 * @returns Promise<Map<string, ValidationResult>>
 */
export async function validateEndpoints(
  endpoints: TEndpoint[],
  timeout: number = 5000,
): Promise<Map<string, ValidationResult>> {
  const results = new Map<string, ValidationResult>();

  const validationPromises = endpoints.map(async (endpoint) => {
    const result = await validateEndpoint(endpoint, timeout);
    results.set(endpoint.name, result);
  });

  await Promise.allSettled(validationPromises);

  return results;
}
