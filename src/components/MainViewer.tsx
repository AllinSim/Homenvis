// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Commercial
//
// Homenvis — LBM-based indoor airflow simulation.
// Copyright (c) 2026 Haocheng Wen / AllinSim. All rights reserved.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public
// License along with this program.  If not, see
// <https://www.gnu.org/licenses/>.
//
// Commercial licenses are available. Contact AllinSim for details.

import dynamic from 'next/dynamic';
import { type RoomLayout } from '@/lib/room-layout';
import { useI18n } from '@/lib/i18n-context';

const FlowViewer3D = dynamic(() => import('@/components/FlowViewer3D'), { ssr: false });

interface MainViewerProps {
  tab: 'layout' | 'simulation' | 'results';
  room: RoomLayout;
  setRoom: React.Dispatch<React.SetStateAction<RoomLayout>>;
  resultsVersion: number;
  isMounted: boolean;
  Nx: number;
  Ny: number;
  Nz: number;
  showVentArrows?: boolean;
}

export default function MainViewer({ tab, room, setRoom, resultsVersion, isMounted, Nx, Ny, Nz, showVentArrows = false }: MainViewerProps) {
  const { t } = useI18n();
  // Always render a single stable FlowViewer3D with a FIXED key.
  // Switching tabs should NOT destroy/recreate the Three.js Canvas —
  // that resets camera position, OrbitControls state, and all internal state.
  // FlowViewer3D internally reads results from the global store and decides
  // what to render based on resultsVersion (0 = no results → just room geometry).

  if (!isMounted) {
    return (
      <div className="h-full rounded-2xl shadow-xl border border-gray-200 dark:border-slate-700 overflow-hidden flex items-center justify-center bg-gray-900 dark:bg-black">
        <div className="text-white text-sm">{t('viewer.loading3d')}</div>
      </div>
    );
  }

  return (
    <div className="h-full bg-gray-50 dark:bg-slate-800 rounded-2xl shadow-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
      <FlowViewer3D
        key="main-viewer" // FIXED key — never changes, prevents Canvas rebuild on tab switch
        room={room}
        setRoom={setRoom}
        resultsVersion={resultsVersion}
        Nx={Nx}
        Ny={Ny}
        Nz={Nz}
        showVentArrows={showVentArrows}
      />
    </div>
  );
}