# inspAI Mobile

PoC for inspection built with Expo and the Cactus SDK for local model inference.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      iOS Device                              │
│                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │   Text Model    │  │  Vision Model   │  │  Knowledge  │  │
│  │  LFM2-1.2B-RAG  │  │  LFM2-VL-450M   │  │    Base     │  │
│  │     (INT4)      │  │     (INT4)      │  │ (AsyncStore)│  │
│  └────────┬────────┘  └────────┬────────┘  └──────┬──────┘  │
│           │                    │                  │         │
│           └──────────┬─────────┴──────────────────┘         │
│                      │                                      │
│             ┌────────▼────────┐                             │
│             │   Cactus SDK    │                             │
│             │ (Neural Engine) │                             │
│             └────────┬────────┘                             │
│                      │                                      │
│             ┌────────▼────────┐                             │
│             │  React Native   │                             │
│             │   Application   │                             │
│             └─────────────────┘                             │
│                                                              │
│              No Cloud Dependencies                           │
└─────────────────────────────────────────────────────────────┘
```

The app runs two Liquid AI models locally on the device:

### Text Model (LFM2-1.2B-RAG)

- Optimized for retrieval-augmented generation
- Handles policy Q&A with document grounding
- Generates embeddings for semantic document search
- Supports tool calling for report generation

### Vision Model (LFM2-VL-450M)

- Vision-language model optimized for Apple Neural Engine
- Analyzes uploaded damage photos
- Returns damage assessments with severity scoring

Both models run entirely locally using INT4 quantization, requiring no internet connection after initial download.

## Features

### Inspection Chat

- Upload photos from camera or gallery
- Real-time damage analysis with severity scoring (1-10)
- Policy-grounded answers using RAG
- Streaming token output with markdown rendering
- Source attribution for retrieved context

### Knowledge Base

- PDF and text document ingestion
- Automatic chunking (500 character segments)
- On-device embedding generation
- Cosine similarity retrieval (top-3)
- Persistent local storage via AsyncStorage

### Report Generation

- Manual trigger via Report button
- Automatic trigger via tool calling ("generate report")
- Aggregates all damage assessments from chat
- Generates formatted PDF with embedded images
- Share via system sheet

## Technical Details

### RAG Pipeline

```
Document Ingestion:
  PDF/Text ──► Chunk (500 chars) ──► Embed ──► Store

Query Time:
  Query ──► Embed ──► Cosine Similarity ──► Top-K ──► Context Injection ──► LLM
```

The text model (LFM2-1.2B-RAG) handles both document embeddings (at ingestion) and query embeddings (at retrieval), maintaining vector space alignment.

### Model Routing

```
User Input
    │
    ├── Has Image? ──► Vision Model (LFM2-VL-450M)
    │                       │
    │                       ▼
    │                  Damage Assessment
    │
    └── Text Only? ──► RAG Retrieval ──► Text Model (LFM2-1.2B-RAG)
                                              │
                                              ├── Normal Response
                                              └── Tool Call ──► PDF Report
```

### Tool Calling

The text model supports function calling for automated report generation:

```typescript
{
  name: "generate_report",
  parameters: {
    severity: number,      // 1-10
    summary: string,
    damage_description: string,
    recommendations: string
  }
}
```

## Requirements

- Node.js 18+
- Xcode 15+
- Physical iOS device (models require Neural Engine)
- ~2GB storage for model weights
- ~1GB RAM during inference

## Setup

```bash
npm install
npx pod-install
npx expo run:ios
```

The app downloads model weights on first launch (~1.5GB total). This requires internet connectivity and may take several minutes.

## Project Structure

```
mobile/
├── app/
│   ├── (tabs)/
│   │   ├── index.tsx          # Home screen with start button
│   │   ├── explore.tsx        # Knowledge base management
│   │   └── _layout.tsx        # Tab navigation
│   ├── inspection/
│   │   └── [id].tsx           # Main inspection chat interface
│   └── _layout.tsx            # Root layout
├── assets/                    # App icons and images
├── patches/                   # Native module patches
├── app.json                   # Expo configuration
└── package.json
```
