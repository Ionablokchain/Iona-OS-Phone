import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { api } from '@/src/utils/api';

type BridgeState = {
  is_simulated: boolean;
  last_kernel_ping: string | null;
  consecutive_failures: number;
  network_stability: number;
  hamiltonian_buffer_size: number;
  ui_mode: 'live' | 'simulated';
  kernel_url: string;
};

type HamiltonianStream = {
  buffer: any[];
  metrics: {
    min: number;
    max: number;
    avg: number;
    variance: number;
    slope: number;
    network_stability: number;
  };
};

type SystemBridgeCtx = {
  bridge: BridgeState;
  hamiltonian: HamiltonianStream | null;
  isSimulated: boolean;       // shorthand
  networkStability: number;   // 0.0–1.0
};

const defaultBridge: BridgeState = {
  is_simulated: true,
  last_kernel_ping: null,
  consecutive_failures: 0,
  network_stability: 1.0,
  hamiltonian_buffer_size: 0,
  ui_mode: 'simulated',
  kernel_url: 'http://localhost:7777',
};

const Ctx = createContext<SystemBridgeCtx>({
  bridge: defaultBridge,
  hamiltonian: null,
  isSimulated: true,
  networkStability: 1.0,
});

export const useSystemBridge = () => useContext(Ctx);

export function SystemBridgeProvider({ children }: { children: React.ReactNode }) {
  const [bridge, setBridge] = useState<BridgeState>(defaultBridge);
  const [hamiltonian, setHamiltonian] = useState<HamiltonianStream | null>(null);
  const pollRef = useRef<any>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const [b, h] = await Promise.all([
          api.getBridgeStatus(),
          api.getHamiltonianStream(),
        ]);
        setBridge(b);
        setHamiltonian(h);
      } catch {}
    };

    poll();
    pollRef.current = setInterval(poll, 1000);
    return () => clearInterval(pollRef.current);
  }, []);

  return (
    <Ctx.Provider value={{
      bridge,
      hamiltonian,
      isSimulated: bridge.is_simulated,
      networkStability: bridge.network_stability,
    }}>
      {children}
    </Ctx.Provider>
  );
}
