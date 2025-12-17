import React, { ElementType, ReactNode } from 'react';
import { composeClassName } from './classNames';

type TitleProps = Record<string, unknown>;

interface PanelHeaderProps {
  className?: string;
  leading?: ReactNode;
  title?: ReactNode;
  titleTag?: ElementType;
  titleProps?: TitleProps;
  actions?: ReactNode;
}

const PanelHeader: React.FC<PanelHeaderProps> = ({
  className = '',
  leading = null,
  title = null,
  titleTag: HeadingTag = 'h2',
  titleProps = {},
  actions = null,
}) => {
  const headerClassName = composeClassName('panel-header', className);

  const renderTitle = (): ReactNode => {
    if (title == null) {
      return null;
    }

    if (React.isValidElement(title)) {
      if (title.type === React.Fragment) {
        return (
          <span className="panel-header__title" {...titleProps}>
            {title}
          </span>
        );
      }

      const existingClassName = (title.props as { className?: string })?.className ?? '';
      const mergedClassName = composeClassName('panel-header__title', existingClassName);
      return React.cloneElement(title, {
        ...titleProps,
        className: mergedClassName,
      });
    }

    return (
      <HeadingTag className="panel-header__title" {...titleProps}>
        {title}
      </HeadingTag>
    );
  };

  return (
    <div className={headerClassName}>
      {leading ? <div className="panel-header__leading">{leading}</div> : null}
      {renderTitle()}
      {actions ? <div className="panel-header__actions">{actions}</div> : null}
    </div>
  );
};

export default PanelHeader;
