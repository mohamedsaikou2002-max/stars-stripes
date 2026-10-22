import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import type { EventBuffer } from '../src/lib/eagle/core.ts';
export function policyOrigins(origin?: string): string[];
export function securityHeaders(origins: string[], nonce?: string): Record<string, string>;
export function createMonitorHandler(options?: { backendOrigins?: string[]; nonce?: string; buffer?: EventBuffer }): (req: IncomingMessage, res: ServerResponse, next?: () => void) => Promise<void>;
export function createAppServer(options?: { backendOrigins?: string[]; root?: string }): Server;
