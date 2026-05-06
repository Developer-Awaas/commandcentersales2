import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { Spinner } from '../components/ui/Spinner';
import { ProjectList } from './projects/ProjectList';
import { ProjectDetail } from './projects/ProjectDetail';
import { ProjectForm } from './projects/ProjectForm';
import { type Project, type ProjectView } from './projects/types';

export function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ProjectView>('list');
  const [selected, setSelected] = useState<Project | null>(null);

  async function fetchProjects() {
    setLoading(true);
    const { data } = await supabase
      .from('projects')
      .select('*')
      .eq('is_active', true)
      .eq('org_id', getOrgId())
      .order('priority', { ascending: true })
      .order('name');
    setProjects((data ?? []) as Project[]);
    setLoading(false);
  }

  useEffect(() => {
    fetchProjects();
  }, []);

  function openDetail(p: Project) {
    setSelected(p);
    setView('detail');
  }

  function openAdd() {
    setSelected(null);
    setView('form');
  }

  function openEdit() {
    setView('form');
  }

  function backToList() {
    setSelected(null);
    setView('list');
  }

  async function handleSaved() {
    await fetchProjects();
    setView('list');
    setSelected(null);
  }

  async function handleDeleted() {
    await fetchProjects();
    setView('list');
    setSelected(null);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (view === 'detail' && selected) {
    return (
      <ProjectDetail
        project={selected}
        onBack={backToList}
        onEdit={openEdit}
        onDeleted={handleDeleted}
      />
    );
  }

  if (view === 'form') {
    return (
      <ProjectForm
        project={selected}
        onCancel={() => (selected ? setView('detail') : setView('list'))}
        onSaved={handleSaved}
      />
    );
  }

  return (
    <ProjectList
      projects={projects}
      onSelect={openDetail}
      onAdd={openAdd}
    />
  );
}
