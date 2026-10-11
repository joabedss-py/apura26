import { useEffect, useRef, useState } from 'react';
import { getCandidateColor } from '../services/colors';
import { getCandidatePhotoUrl } from '../services/candidate-photos';
import type { ElectionCandidate } from '../types';

interface CandidatePortraitProps {
  candidate: ElectionCandidate;
  region: string;
  className: string;
}

function candidateInitials(candidate: ElectionCandidate): string {
  return (candidate.ballotName.trim() || candidate.name.trim())
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toLocaleUpperCase('pt-BR');
}

export default function CandidatePortrait({ candidate, region, className }: CandidatePortraitProps) {
  const portraitRef = useRef<HTMLSpanElement | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const normalizedStatus = (candidate.status ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleUpperCase('pt-BR');
  const notElected = normalizedStatus.includes('NAO ELEITO');

  useEffect(() => {
    let active = true;
    const element = portraitRef.current;
    if (!element) return () => { active = false; };

    const loadPhoto = () => {
      void getCandidatePhotoUrl(candidate.id, region).then((url) => {
        if (active) setPhotoUrl(url);
      });
    };

    if (typeof IntersectionObserver === 'undefined') {
      loadPhoto();
      return () => { active = false; };
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        loadPhoto();
      }
    }, { rootMargin: '80px' });
    observer.observe(element);

    return () => {
      active = false;
      observer.disconnect();
    };
  }, [candidate.id, region]);

  return (
    <span
      ref={portraitRef}
      className={`candidate-photo ${className}${notElected ? ' candidate-photo--not-elected' : ''}`}
      style={{ backgroundColor: getCandidateColor(candidate) }}
      aria-hidden="true"
    >
      {photoUrl
        ? <img src={photoUrl} alt="" loading="lazy" decoding="async" onError={() => setPhotoUrl(null)} />
        : <span>{candidateInitials(candidate)}</span>}
    </span>
  );
}
