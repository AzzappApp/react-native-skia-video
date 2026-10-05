import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    'getting-started',
    'video-player',
    {
      type: 'category',
      label: 'Video Composition',
      link: { type: 'doc', id: 'video-composition/index' },
      items: [
        'video-composition/playback',
        'video-composition/audio',
        'video-composition/exporting',
      ],
    },
    'android-capabilities',
    'example',
    'migration',
    'api',
  ],
};

export default sidebars;
