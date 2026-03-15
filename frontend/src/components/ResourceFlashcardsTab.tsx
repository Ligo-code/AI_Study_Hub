import { useEffect, useState } from "react";
import {
  deleteFlashcardSet,
  generateFlashcards,
  getFlashcardSetById,
  type FlashcardSetDetailDto,
} from "../api/flashcards";
import FlashcardsEmptyState from "./flashcards/FlashcardsEmptyState";
import FlashcardSetsPage from "./flashcards/FlashcardSetsPage";
import FlashcardPlayer from "./flashcards/FlashcardPlayer";
import { useFlashcardSets } from "./flashcards/useFlashcardSets";

type Props = {
  resourceId: string;
  resourceTitle?: string;
};

export default function ResourceFlashcardsTab({
  resourceId,
  resourceTitle,
}: Props) {
  const { sets, countsBySetId, isLoading, error, reload } =
    useFlashcardSets(resourceId);

  const [isGenerating, setIsGenerating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [selectedSet, setSelectedSet] = useState<FlashcardSetDetailDto | null>(
    null
  );
  const [isLoadingSet, setIsLoadingSet] = useState(false);
  const [setError, setSetError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSelectedSet(setId: string) {
      try {
        setIsLoadingSet(true);
        setSetError(null);
        const data = await getFlashcardSetById(setId);
        if (cancelled) return;
        setSelectedSet(data);
      } catch (e) {
        if (cancelled) return;
        setSelectedSet(null);
        setSelectedSetId(null);
        setSetError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        if (cancelled) return;
        setIsLoadingSet(false);
      }
    }

    if (!selectedSetId) return;
    loadSelectedSet(selectedSetId);

    return () => {
      cancelled = true;
    };
  }, [selectedSetId]);

  async function handleGenerate() {
    try {
      setIsGenerating(true);
      await generateFlashcards({ resourceId, title: resourceTitle, count: 10 });
      await reload();
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleDelete(setId: string) {
    try {
      setDeletingId(setId);
      await deleteFlashcardSet(setId);
      await reload();
      if (selectedSetId === setId) {
        setSelectedSetId(null);
        setSelectedSet(null);
      }
    } finally {
      setDeletingId(null);
    }
  }

  if (isLoading)
    return <div className="py-10 text-sm text-gray-500">Loading…</div>;

  if (error) {
    return (
      <div className="py-10">
        <div className="mb-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-sm font-semibold text-[var(--color-primary)] hover:underline"
        >
          Reload
        </button>
      </div>
    );
  }

  if (selectedSetId) {
    if (isLoadingSet)
      return <div className="py-10 text-sm text-gray-500">Loading…</div>;
    if (setError) {
      return (
        <div className="py-10">
          <div className="mb-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {setError}
          </div>
          <button
            type="button"
            onClick={() => setSelectedSetId(null)}
            className="text-sm font-semibold text-[var(--color-primary)] hover:underline"
          >
            ← Back to sets
          </button>
        </div>
      );
    }

    if (!selectedSet) return null;

    return (
      <FlashcardPlayer
        set={selectedSet}
        onBack={() => {
          setSelectedSetId(null);
          setSelectedSet(null);
        }}
      />
    );
  }

  if (sets.length === 0) {
    return (
      <FlashcardsEmptyState
        onGenerate={handleGenerate}
        isGenerating={isGenerating}
      />
    );
  }

  return (
    <FlashcardSetsPage
      sets={sets}
      countsBySetId={countsBySetId}
      isGenerating={isGenerating}
      deletingId={deletingId}
      onGenerate={handleGenerate}
      onOpenSet={(id) => setSelectedSetId(id)}
      onDeleteSet={handleDelete}
    />
  );
}
