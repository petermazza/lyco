"use client";

import React, { useRef, useState, useCallback } from "react";
import {
  splitParagraphs,
  splitSentences,
  tokenizeSentenceTerms,
} from "@/lib/message-parts";

// Renders an assistant message whose sentences react to hover/tap:
// a small action bar offers reply / why? / explain this, and key
// terms open a menu that can ask in side chat or search the web.
// The message text div keeps only the original characters — the
// toolbar and popover render outside it so textContent is unchanged.

interface ActiveSentence {
  paragraphIndex: number;
  sentenceIndex: number;
  sentence: string;
  paragraph: string;
  multiSentence: boolean;
}

interface ActiveTerm {
  paragraphIndex: number;
  sentenceIndex: number;
  segmentIndex: number;
  term: string;
  sentence: string;
}

interface InteractiveBotMessageProps {
  text: string;
  style?: React.CSSProperties;
  onReply: (quote: string) => void;
  onAskWhy: (sentence: string) => void;
  onExplain: (sentence: string) => void;
  onAskTerm: (term: string, sentence: string) => void;
}

const actionBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: "2px 4px",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  color: "var(--color-accent)",
};

export function InteractiveBotMessage({
  text,
  style,
  onReply,
  onAskWhy,
  onExplain,
  onAskTerm,
}: InteractiveBotMessageProps) {
  const [activeSentence, setActiveSentence] = useState<ActiveSentence | null>(null);
  const [activeTerm, setActiveTerm] = useState<ActiveTerm | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setActiveSentence(null), 280);
  }, []);

  const cancelHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  const paragraphs = splitParagraphs(text);

  return (
    <div
      ref={wrapRef}
      style={{ position: "relative" }}
      onClick={(e) => {
        // Tapping message whitespace dismisses any open tools
        if (activeTerm) setActiveTerm(null);
        else if (activeSentence) setActiveSentence(null);
        e.stopPropagation();
      }}
    >
      <div style={style} onMouseLeave={scheduleHide}>
        {paragraphs.map((paragraph, pi) => {
          const sentences = splitSentences(paragraph);
          return (
            <span key={pi}>
              {sentences.map((sentence, si) => {
                const isActive =
                  activeSentence?.paragraphIndex === pi &&
                  activeSentence?.sentenceIndex === si;
                const segments = tokenizeSentenceTerms(sentence);
                return (
                  <span
                    key={si}
                    data-testid="bot-sentence"
                    onMouseEnter={() => {
                      cancelHide();
                      setActiveSentence({
                        paragraphIndex: pi,
                        sentenceIndex: si,
                        sentence,
                        paragraph,
                        multiSentence: sentences.length > 1,
                      });
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (activeTerm) setActiveTerm(null);
                      setActiveSentence({
                        paragraphIndex: pi,
                        sentenceIndex: si,
                        sentence,
                        paragraph,
                        multiSentence: sentences.length > 1,
                      });
                    }}
                    style={{
                      borderRadius: 4,
                      transition: "background 140ms ease",
                      background: isActive
                        ? "color-mix(in srgb, var(--color-text) 7%, transparent)"
                        : "transparent",
                    }}
                  >
                    {segments.map((seg, gi) =>
                      seg.isTerm ? (
                        <span
                          key={gi}
                          role="button"
                          tabIndex={0}
                          data-testid="search-term"
                          aria-label={`search term ${seg.term}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveSentence(null);
                            setActiveTerm({
                              paragraphIndex: pi,
                              sentenceIndex: si,
                              segmentIndex: gi,
                              term: seg.term!,
                              sentence,
                            });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              setActiveSentence(null);
                              setActiveTerm({
                                paragraphIndex: pi,
                                sentenceIndex: si,
                                segmentIndex: gi,
                                term: seg.term!,
                                sentence,
                              });
                            }
                          }}
                          style={{
                            borderBottom:
                              "1px dotted color-mix(in srgb, var(--color-accent) 65%, transparent)",
                            cursor: "pointer",
                          }}
                        >
                          {seg.text}
                        </span>
                      ) : (
                        <React.Fragment key={gi}>{seg.text}</React.Fragment>
                      )
                    )}
                  </span>
                );
              })}
              {pi < paragraphs.length - 1 ? "\n" : ""}
            </span>
          );
        })}
      </div>

      {/* sentence action bar — outside the text div */}
      {activeSentence && !activeTerm && (
        <div
          data-testid="sentence-actions"
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            right: 0,
            top: "100%",
            marginTop: 2,
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            gap: 2,
            background: "var(--color-surface)",
            border: "1px solid var(--app-hairline)",
            borderRadius: "var(--radius-md)",
            padding: "3px 6px",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <button
            type="button"
            aria-label="reply to sentence"
            style={actionBtn}
            onClick={() => {
              const quote = activeSentence.sentence.trim();
              setActiveSentence(null);
              onReply(quote);
            }}
          >
            reply
          </button>
          {activeSentence.multiSentence && (
            <button
              type="button"
              aria-label="reply to paragraph"
              style={actionBtn}
              onClick={() => {
                const quote = activeSentence.paragraph.trim();
                setActiveSentence(null);
                onReply(quote);
              }}
            >
              reply to paragraph
            </button>
          )}
          <button
            type="button"
            aria-label="ask why"
            style={actionBtn}
            onClick={() => {
              const s = activeSentence.sentence.trim();
              setActiveSentence(null);
              onAskWhy(s);
            }}
          >
            why?
          </button>
          <button
            type="button"
            aria-label="explain this"
            style={actionBtn}
            onClick={() => {
              const s = activeSentence.sentence.trim();
              setActiveSentence(null);
              onExplain(s);
            }}
          >
            explain this
          </button>
        </div>
      )}

      {/* search-term popover — outside the text div */}
      {activeTerm && (
        <div
          data-testid="search-term-menu"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            right: 0,
            top: "100%",
            marginTop: 2,
            zIndex: 10,
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            gap: 2,
            background: "var(--color-surface)",
            border: "1px solid var(--app-hairline)",
            borderRadius: "var(--radius-md)",
            padding: "4px",
            minWidth: 140,
            boxShadow: "var(--shadow-md)",
          }}
        >
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 13, minHeight: 36, justifyContent: "flex-start", paddingInline: 8 }}
            onClick={() => {
              const { term, sentence } = activeTerm;
              setActiveTerm(null);
              onAskTerm(term, sentence);
            }}
          >
            Ask in side chat
          </button>
          <a
            className="btn btn-ghost"
            style={{ fontSize: 13, minHeight: 36, justifyContent: "flex-start", paddingInline: 8 }}
            href={`https://www.google.com/search?q=${encodeURIComponent(activeTerm.term)}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setActiveTerm(null)}
          >
            Search the web
          </a>
        </div>
      )}
    </div>
  );
}
