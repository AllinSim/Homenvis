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

import { useState } from 'react';

interface UseVisualizationPerformanceOptions {
  defaultDownsample?: number;
  defaultMaxPoints?: number;
}

export function useVisualizationPerformance(options: UseVisualizationPerformanceOptions = {}) {
  const [downsampleFactor, setDownsampleFactor] = useState(options.defaultDownsample || 4);
  const [maxPoints, setMaxPoints] = useState(options.defaultMaxPoints || 50000);
  const [enableAdaptive, setEnableAdaptive] = useState(true);
  const [renderQuality, setRenderQuality] = useState<'low' | 'medium' | 'high'>('medium');

  // Quality presets
  const qualityPresets = {
    low: { downsample: 6, maxPoints: 20000, step: 5 },
    medium: { downsample: 4, maxPoints: 50000, step: 3 },
    high: { downsample: 2, maxPoints: 100000, step: 2 },
  };

  const setQuality = (quality: 'low' | 'medium' | 'high') => {
    setRenderQuality(quality);
    const preset = qualityPresets[quality];
    setDownsampleFactor(preset.downsample);
    setMaxPoints(preset.maxPoints);
  };

  return {
    downsampleFactor,
    maxPoints,
    enableAdaptive,
    renderQuality,
    setDownsampleFactor,
    setMaxPoints,
    setEnableAdaptive,
    setQuality,
  };
}
