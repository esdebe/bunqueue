import sharp from 'sharp';
import { mkdirSync } from 'fs';

const sections = [
  { name: 'getting-started', title: 'Getting Started', subtitle: 'Installation and Quick Start Guide', color: '#10b981' },
  { name: 'client-sdk', title: 'Client SDK', subtitle: 'Queue, Worker and Events API', color: '#3b82f6' },
  { name: 'server-mode', title: 'Server Mode', subtitle: 'TCP and HTTP API', color: '#8b5cf6' },
  { name: 'advanced', title: 'Advanced Features', subtitle: 'Cron, Backups and Rate Limiting', color: '#f59e0b' },
  { name: 'api-reference', title: 'API Reference', subtitle: 'Types, Examples and Migration', color: '#ec4899' },
  { name: 'worker', title: 'Worker API', subtitle: 'Job Processing and Sandboxed Workers', color: '#06b6d4' },
  { name: 'queue', title: 'Queue API', subtitle: 'Job Management and Dead Letter Queue', color: '#84cc16' },
  { name: 'benchmarks', title: 'Performance', subtitle: '32x Faster than BullMQ', color: '#ef4444' },
];

mkdirSync('./public/og', { recursive: true });

for (const section of sections) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#fafafa"/>
      <stop offset="100%" style="stop-color:#f5f5f5"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:${section.color}"/>
      <stop offset="100%" style="stop-color:${section.color}cc"/>
    </linearGradient>
    <linearGradient id="bunny" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#f9a8d4"/>
      <stop offset="100%" style="stop-color:#ec4899"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Subtle grid -->
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e5e5e5" stroke-width="1"/>
  </pattern>
  <rect width="1200" height="630" fill="url(#grid)" opacity="0.5"/>

  <!-- Left accent bar -->
  <rect x="0" y="0" width="6" height="630" fill="${section.color}"/>

  <!-- Logo area - bunny ears simplified -->
  <g transform="translate(80, 45)">
    <ellipse cx="12" cy="8" rx="4" ry="10" fill="url(#bunny)"/>
    <ellipse cx="28" cy="8" rx="4" ry="10" fill="url(#bunny)"/>
    <circle cx="20" cy="24" r="14" fill="url(#bunny)"/>
    <circle cx="15" cy="22" r="2" fill="#18181b"/>
    <circle cx="25" cy="22" r="2" fill="#18181b"/>
    <ellipse cx="20" cy="28" rx="2" ry="1.5" fill="#be185d"/>
  </g>

  <!-- bunqueue text with professional font -->
  <text x="135" y="70" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="28" font-weight="700" fill="#18181b" letter-spacing="-0.5">bunqueue</text>

  <!-- Main content area -->
  <g transform="translate(80, 180)">
    <!-- Section title -->
    <text x="0" y="80" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="64" font-weight="800" fill="#0a0a0a" letter-spacing="-2">${section.title}</text>

    <!-- Subtitle -->
    <text x="0" y="140" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="28" font-weight="400" fill="#525252">${section.subtitle}</text>

    <!-- Badge -->
    <rect x="0" y="180" width="180" height="44" rx="22" fill="url(#accent)"/>
    <text x="90" y="210" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="600" fill="#ffffff" text-anchor="middle">Documentation</text>
  </g>

  <!-- Decorative accent circle -->
  <circle cx="1000" cy="315" r="120" fill="${section.color}" opacity="0.1"/>

  <!-- Footer -->
  <rect x="0" y="580" width="1200" height="50" fill="#fafafa"/>
  <text x="600" y="612" text-anchor="middle" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="18" fill="#a3a3a3">github.com/egeominotti/bunqueue</text>

  <!-- Bottom accent line -->
  <rect x="0" y="625" width="1200" height="5" fill="${section.color}"/>
</svg>`;

  const buffer = Buffer.from(svg);
  const outputPath = './public/og/' + section.name + '.png';
  await sharp(buffer).resize(1200, 630).png().toFile(outputPath);
  console.log('Created ' + outputPath);
}

console.log('\nAll section OG images created!');
