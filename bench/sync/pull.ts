import { spawn } from 'node:child_process';
import { createClient } from '../../src/adb';
import { performance, PerformanceObserver } from 'perf_hooks';

const deviceId = process.env.DEVICE_ID || '';
const deviceParams = deviceId ? ['-s', deviceId] : [];

// Number of iterations for each benchmark
const ITERATIONS = 3;

interface BenchmarkResult {
  name: string;
  duration: number;
  opsPerSecond: number;
}

async function runBenchmark(name: string, fn: () => Promise<void>): Promise<BenchmarkResult> {
  const results: number[] = [];
  
  // Run warm-up iteration
  await fn();
  
  // Run actual benchmark iterations
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    results.push(end - start);
  }
  
  const totalDuration = results.reduce((sum, time) => sum + time, 0);
  const avgDuration = totalDuration / results.length;
  const opsPerSecond = 1000 / avgDuration;
  
  return {
    name,
    duration: avgDuration,
    opsPerSecond
  };
}

async function main() {
  // Setup performance observer
  const obs = new PerformanceObserver((list) => {
    const entries = list.getEntries();
    entries.forEach((entry) => {
      console.log(`${entry.name}: ${entry.duration}ms`);
    });
  });
  obs.observe({ entryTypes: ['measure'], buffered: true });

  const benchmarks = [
    {
      name: 'pull /dev/graphics/fb0 using ADB CLI',
      fn: () => new Promise<void>((resolve) => {
        const proc = spawn('adb', [...deviceParams, 'pull', '/dev/graphics/fb0', '/dev/null']);
        proc.stdout.on('end', () => resolve());
      })
    },
    {
      name: 'pull /dev/graphics/fb0 using client.pull()',
      fn: async () => {
        const client = createClient();
        const stream = await client
          .getDevice(deviceId)
          .pull('/dev/graphics/fb0');
        stream.resume();
        return new Promise<void>((resolve) => stream.on('end', () => resolve()));
      }
    }
  ];

  console.log(`Running ${ITERATIONS} iterations for each benchmark...\n`);

  const results: BenchmarkResult[] = [];
  for (const benchmark of benchmarks) {
    try {
      const result = await runBenchmark(benchmark.name, benchmark.fn);
      results.push(result);
    } catch (error) {
      console.error(`Error running benchmark "${benchmark.name}":`, error);
    }
  }

  // Print results
  console.log('\nResults:');
  console.log('----------------------------------------');
  results.forEach((result) => {
    console.log(`\n${result.name}`);
    console.log(`  Average duration: ${result.duration.toFixed(2)}ms`);
    console.log(`  Operations/second: ${result.opsPerSecond.toFixed(2)}`);
  });

  // Determine the faster method
  if (results.length === 2) {
    const [first, second] = results;
    const diff = Math.abs(first.opsPerSecond - second.opsPerSecond);
    const faster = first.opsPerSecond > second.opsPerSecond ? first : second;
    const percentage = ((diff / Math.min(first.opsPerSecond, second.opsPerSecond)) * 100).toFixed(2);
    
    console.log('\nComparison:');
    console.log(`"${faster.name}" is ${percentage}% faster`);
  }
}

// Run benchmarks
main().catch(console.error);