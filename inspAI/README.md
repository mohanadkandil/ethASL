# inspAI

On-device AI for field inspection workflows. A proof-of-concept exploring the practical deployment of small language models and vision-language models on mobile devices for real-world insurance claim processing.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              USER LAYER                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                  │
│  │   Camera    │    │    Text     │    │   Document  │                  │
│  │   Input     │    │   Query     │    │   Upload    │                  │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                  │
└─────────┼──────────────────┼──────────────────┼─────────────────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          APPLICATION LAYER                               │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                     Inspection Chat Interface                     │   │
│  │   • Streaming markdown rendering    • Multi-modal messages       │   │
│  │   • Source attribution              • PDF report export          │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────┐   │
│  │     Knowledge Base Manager  │  │      Report Generator           │   │
│  │   • PDF/text ingestion      │  │   • Tool call handling          │   │
│  │   • Text chunking           │  │   • PDF export via expo-print   │   │
│  └─────────────────────────────┘  └─────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          INTELLIGENCE LAYER                              │
│                                                                          │
│  ┌────────────────────────┐        ┌────────────────────────────────┐   │
│  │    VISION PIPELINE     │        │        TEXT PIPELINE           │   │
│  │                        │        │                                 │   │
│  │  ┌──────────────────┐  │        │  ┌───────────┐  ┌───────────┐  │   │
│  │  │  LFM2-VL-450M    │  │        │  │  Query    │  │  Document │  │   │
│  │  │  Vision-Language │  │        │  │  Embed    │  │  Embed    │  │   │
│  │  └────────┬─────────┘  │        │  └─────┬─────┘  └─────┬─────┘  │   │
│  │           │            │        │        │              │        │   │
│  │           ▼            │        │        ▼              ▼        │   │
│  │  ┌──────────────────┐  │        │  ┌─────────────────────────┐   │   │
│  │  │ Damage Analysis  │  │        │  │   Cosine Similarity     │   │   │
│  │  │ • Severity 1-10  │  │        │  │   Retrieval (Top-K)     │   │   │
│  │  │ • Location       │  │        │  └───────────┬─────────────┘   │   │
│  │  │ • Repair estimate│  │        │              │                 │   │
│  │  └──────────────────┘  │        │              ▼                 │   │
│  │                        │        │  ┌─────────────────────────┐   │   │
│  └────────────────────────┘        │  │   LFM2-1.2B-RAG         │   │   │
│                                    │  │   • Policy Q&A          │   │   │
│                                    │  │   • Tool calling        │   │   │
│                                    │  │   • Grounded response   │   │   │
│                                    │  └─────────────────────────┘   │   │
│                                    └────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           RUNTIME LAYER                                  │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      Cactus SDK                                  │    │
│  │   • INT4 Quantization  • Streaming inference  • Model caching   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                    │                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
│  │  Apple Neural    │  │   AsyncStorage   │  │    Expo FileSystem   │   │
│  │  Engine (ANE)    │  │   (Embeddings)   │  │    (PDF Storage)     │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           DEVICE LAYER                                   │
│                                                                          │
│        iPhone / iPad  •  ~2GB Model Storage  •  No Network Required     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Research Context

Traditional inspection workflows rely on manual assessment or cloud-based AI services. Both approaches have limitations:

| Approach              | Limitations                                           |
| --------------------- | ----------------------------------------------------- |
| **Manual Inspection** | Slow, inconsistent, requires expertise                |
| **Cloud AI Services** | Privacy concerns, requires connectivity, latency      |
| **On-Device AI**      | Resource constrained, but private and offline-capable |

This work explores the on-device path using models that run entirely on the user's smartphone.

## Key Capabilities

| Capability            | Implementation                                            |
| --------------------- | --------------------------------------------------------- |
| **Vision Analysis**   | LFM2-VL-450M analyzes damage photos with severity scoring |
| **Policy RAG**        | Semantic search over uploaded policy documents            |
| **Tool Calling**      | Automated PDF report generation via function calls        |
| **Streaming UI**      | Real-time token streaming with markdown rendering         |
| **Offline Operation** | Full functionality without network after model download   |

## Data Flow

```
Photo Input ──────► Vision Model ──────► Damage Assessment
                                                │
                                                ▼
Text Query ───► Embed ───► Retrieve ───► Text Model ───► Response
                              │                              │
                              │                              ▼
Policy Docs ──► Chunk ──► Embed ──► Store         Tool Call ──► PDF Report
```

## Demo

[Demo video coming soon]

## Paper

Details on the theoretical foundations and experimental results will be published separately.

## Project Structure

```
inspAI/
└── mobile/          # React Native application (Expo)
    ├── app/
    │   ├── (tabs)/
    │   │   ├── index.tsx        # Home screen
    │   │   └── explore.tsx      # Knowledge base management
    │   └── inspection/
    │       └── [id].tsx         # Inspection chat interface
    └── package.json
```

See the [mobile README](./mobile/README.md) for implementation details.

## Getting Started

```bash
cd mobile
npm install
npx pod-install
npx expo run:ios
```
