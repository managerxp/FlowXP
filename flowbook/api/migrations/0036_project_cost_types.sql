-- the kind of cost a project's bill or expense is (materials, labour, transport...), for the project's cost breakdown
ALTER TABLE documents ADD COLUMN project_category TEXT CHECK (project_category IN ('Materials', 'Labour', 'Transport', 'Contractors', 'Equipment', 'Other'));
ALTER TABLE project_expenses ADD COLUMN category TEXT CHECK (category IN ('Materials', 'Labour', 'Transport', 'Contractors', 'Equipment', 'Other'));
