import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'React Native Skia Video',
  tagline: 'Video playback, compositing and encoding for React Native Skia',
  favicon: 'img/favicon.png',

  url: 'https://azzappapp.github.io',
  baseUrl: '/react-native-skia-video/',

  organizationName: 'AzzappApp',
  projectName: 'react-native-skia-video',
  trailingSlash: false,

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl:
            'https://github.com/AzzappApp/react-native-skia-video/tree/main/docs/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/social-card.png',
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'React Native Skia Video',
      logo: {
        alt: 'React Native Skia Video logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: 'Docs',
        },
        { to: '/docs/api', label: 'API', position: 'left' },
        { to: '/docs/example', label: 'Examples', position: 'left' },
        {
          href: 'https://github.com/AzzappApp/react-native-skia-video',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            { label: 'Getting Started', to: '/docs/getting-started' },
            { label: 'Video Composition', to: '/docs/video-composition' },
            { label: 'API Reference', to: '/docs/api' },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/AzzappApp/react-native-skia-video',
            },
            {
              label: 'Issues',
              href: 'https://github.com/AzzappApp/react-native-skia-video/issues',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'React Native Skia',
              href: 'https://wcandillon.github.io/react-native-skia/',
            },
            {
              label: 'Island Studio (tutorial app)',
              href: 'https://github.com/mlecoq/react-native-video-editor',
            },
            { label: 'Azzapp', href: 'https://azzapp.com' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Azzapp. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
